'use strict';

const Tablero = require('../validators/Tablero');
const { GameMode, PlayerType, GameStatus, GameResult, EndReason, Color, GameSource, START_FEN } = require('../models/constants');
const {
  NotFoundError,
  InvalidStateError,
  NotYourTurnError,
  IllegalMoveError,
  PromotionRequiredError,
  EngineBadMoveError,
  ValidationError,
} = require('../errors');

const ENGINE_NAME = { [PlayerType.STOCKFISH]: 'Stockfish', [PlayerType.AI]: 'IA propia' };
const NOMBRE_MAQUINA = { [GameMode.STOCKFISH]: 'Stockfish', [GameMode.AI]: 'IA propia' };

/**
 * Orquesta el ciclo de vida de la partida (CU-01, CU-02, CU-03, CU-04, CU-06 y pausa/reanudación).
 * No conoce SQL (usa el store) ni la librería de reglas (usa Tablero) ni el motor concreto (usa la fábrica).
 */
class GestorDePartida {
  constructor({ store, sessionFactory }) {
    this.store = store;
    this.sessionFactory = sessionFactory;
  }

  // ───────────────────────── CU-01 Nueva partida ─────────────────────────

  async crearPartida(config) {
    let whiteType = PlayerType.HUMAN;
    let blackType = PlayerType.HUMAN;
    let whiteAlias = config.whiteAlias;
    let blackAlias = config.blackAlias;
    let profile = null;

    if (config.mode !== GameMode.LOCAL) {
      const engineType = config.mode === GameMode.STOCKFISH ? PlayerType.STOCKFISH : PlayerType.AI;
      profile = await this.store.profiles.findByEngineAndName(engineType, config.difficulty);
      if (!profile) throw new ValidationError(`No existe el perfil ${config.difficulty} para ${config.mode}`);
      const maquina = NOMBRE_MAQUINA[config.mode];
      if (config.playerColor === Color.WHITE) {
        blackType = engineType;
        whiteAlias = config.alias;
        blackAlias = maquina;
      } else {
        whiteType = engineType;
        whiteAlias = maquina;
        blackAlias = config.alias;
      }
    }

    const game = await this.store.games.create({
      mode: config.mode,
      whiteType,
      blackType,
      whiteAlias,
      blackAlias,
      difficultyProfileId: profile ? profile.id : null,
      status: GameStatus.IN_PROGRESS,
      currentFen: START_FEN,
      source: GameSource.USER,
    });

    return this.#vistaPartida(game, new Tablero());
  }

  // ───────────────────────── CU-06 Realizar jugada ─────────────────────────

  async obtenerMovimientosLegales(id, casilla) {
    const { game, tablero } = await this.#cargar(id);
    if (game.status !== GameStatus.IN_PROGRESS) return { square: casilla, moves: [] };
    return { square: casilla, moves: tablero.obtenerMovimientosLegales(casilla) };
  }

  /** Jugada de un humano (POST /games/:id/moves) */
  async realizarJugada(id, jugada) {
    const { game, moves, tablero } = await this.#cargar(id);
    this.#exigirEnCurso(game);
    const tipoTurno = this.#tipoDelTurno(game, tablero);
    if (tipoTurno !== PlayerType.HUMAN) {
      throw new NotYourTurnError('Es el turno de la máquina: usá POST /games/:id/engine-move');
    }
    return this.#aplicarYGuardar(game, moves, tablero, jugada);
  }

  // ───────────────────────── CU-03 / CU-04 Turno de máquina ─────────────────────────

  async jugarTurnoMaquina(id) {
    const { game, moves, tablero } = await this.#cargar(id);
    this.#exigirEnCurso(game);
    const tipoTurno = this.#tipoDelTurno(game, tablero);
    if (tipoTurno === PlayerType.HUMAN) {
      throw new NotYourTurnError('Es el turno del jugador humano: usá POST /games/:id/moves');
    }

    const profile = game.difficultyProfileId ? await this.store.profiles.findById(game.difficultyProfileId) : null;
    const oponente = this.sessionFactory.crearOponente(tipoTurno, profile);
    let uci;
    try {
      // Si el motor tarda demasiado lanza EngineTimeoutError: no se guardó nada y el turno sigue igual (CU-03 3a).
      uci = await oponente.getNextMove(tablero.fen(), { gameId: game.id, profile });
    } finally {
      await oponente.dispose();
    }

    const jugada = Tablero.parsearUci(uci);
    if (!jugada) throw new EngineBadMoveError(ENGINE_NAME[tipoTurno], uci);
    try {
      return await this.#aplicarYGuardar(game, moves, tablero, jugada);
    } catch (err) {
      if (err instanceof IllegalMoveError || err instanceof PromotionRequiredError) {
        throw new EngineBadMoveError(ENGINE_NAME[tipoTurno], uci);
      }
      throw err;
    }
  }

  // ───────────────────────── Pausa, reanudación y abandono ─────────────────────────

  /** CU-02/03/04 flujo 2a: "Guardar y Salir" */
  async pausarPartida(id) {
    const game = await this.#buscar(id);
    if (game.status !== GameStatus.IN_PROGRESS) {
      throw new InvalidStateError(`Solo se puede pausar una partida en curso (estado actual: ${game.status})`);
    }
    await this.store.games.updateStatus(id, GameStatus.PAUSED);
    return this.obtenerEstado(id);
  }

  /** CU-05: reanudar una partida pendiente. Reconstruye el tablero desde las jugadas guardadas. */
  async reanudarPartida(id) {
    const game = await this.#buscar(id);
    if (game.status !== GameStatus.PAUSED) {
      throw new InvalidStateError(`Solo se puede reanudar una partida pausada (estado actual: ${game.status})`);
    }
    await this.store.games.updateStatus(id, GameStatus.IN_PROGRESS);
    return this.obtenerEstado(id);
  }

  /** RN-03 abandono. En modo LOCAL se indica qué color se rinde; contra la máquina, solo el humano. */
  async rendirse(id, color) {
    const { game, tablero } = await this.#cargar(id);
    if (game.status === GameStatus.FINISHED) throw new InvalidStateError('La partida ya está finalizada');
    const tipo = color === Color.WHITE ? game.whiteType : game.blackType;
    if (tipo !== PlayerType.HUMAN) throw new ValidationError('Solo puede rendirse un jugador humano', { field: 'color' });

    const result = color === Color.WHITE ? GameResult.BLACK_WINS : GameResult.WHITE_WINS;
    await this.store.games.updateResult(id, { result, endReason: EndReason.RESIGNATION });
    const actualizada = await this.store.games.findById(id);
    return this.#vistaPartida(actualizada, tablero);
  }

  async obtenerEstado(id) {
    const { game, tablero } = await this.#cargar(id);
    return this.#vistaPartida(game, tablero);
  }

  // ───────────────────────── Internos ─────────────────────────

  async #buscar(id) {
    const game = await this.store.games.findById(id);
    if (!game) throw new NotFoundError('La partida no existe');
    return game;
  }

  async #cargar(id) {
    const game = await this.#buscar(id);
    const moves = await this.store.moves.findByGameId(id);
    const tablero = Tablero.desdeJugadas(moves);
    if (tablero.fen() !== game.currentFen) {
      // No debería pasar porque jugada y FEN se guardan en la misma transacción.
      throw new InvalidStateError('El FEN guardado no coincide con las jugadas registradas');
    }
    return { game, moves, tablero };
  }

  #exigirEnCurso(game) {
    if (game.status === GameStatus.PAUSED) {
      throw new InvalidStateError('La partida está pausada: reanudala con POST /games/:id/resume');
    }
    if (game.status === GameStatus.FINISHED) throw new InvalidStateError('La partida ya está finalizada');
  }

  #tipoDelTurno(game, tablero) {
    return tablero.turno() === Color.WHITE ? game.whiteType : game.blackType;
  }

  /**
   * Núcleo de CU-06: valida y aplica en el tablero, y guarda jugada + FEN (+ cierre si corresponde)
   * en UNA transacción. Si algo falla no queda nada a medias.
   */
  async #aplicarYGuardar(game, moves, tablero, jugada) {
    const aplicada = tablero.aplicarJugada(jugada); // lanza IllegalMoveError / PromotionRequiredError
    const fin = tablero.evaluarFin();
    const moveNumber = moves.length + 1;

    await this.store.transaction(async (tx) => {
      await tx.moves.create({ gameId: game.id, moveNumber, ...aplicada });
      await tx.games.updateCurrentFen(game.id, aplicada.fenAfter);
      if (fin) await tx.games.updateResult(game.id, fin);
    });

    const actualizada = await this.store.games.findById(game.id);
    return {
      valid: true,
      move: { moveNumber, color: aplicada.color, san: aplicada.san, uci: aplicada.uci },
      ...this.#vistaPartida(actualizada, tablero),
    };
  }

  #vistaPartida(game, tablero) {
    const enCurso = game.status === GameStatus.IN_PROGRESS;
    const tipoTurno = this.#tipoDelTurno(game, tablero);
    return {
      gameId: game.id,
      mode: game.mode,
      difficulty: game.difficulty,
      white: { type: game.whiteType, alias: game.whiteAlias },
      black: { type: game.blackType, alias: game.blackAlias },
      status: game.status,
      fen: game.currentFen,
      turn: tablero.turno(),
      inCheck: tablero.estaEnJaque(),
      // El frontend debe llamar a POST /games/:id/engine-move cuando esto sea true
      machineTurn: enCurso && tipoTurno !== PlayerType.HUMAN,
      result: game.result,
      endReason: game.endReason,
      startedAt: game.startedAt,
      endedAt: game.endedAt,
    };
  }
}

module.exports = GestorDePartida;
