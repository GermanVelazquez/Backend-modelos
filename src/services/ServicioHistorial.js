'use strict';

const { Chess } = require('chess.js');
const { NotFoundError } = require('../errors');
const { GameResult } = require('../models/constants');

const PGN_RESULT = {
  [GameResult.WHITE_WINS]: '1-0',
  [GameResult.BLACK_WINS]: '0-1',
  [GameResult.DRAW]: '1/2-1/2',
};

/** CU-05: listado, detalle y exportación PGN de partidas. */
class ServicioHistorial {
  constructor({ store }) {
    this.store = store;
  }

  async listarPartidas(filtros) {
    const partidas = await this.store.games.findAll(filtros);
    return partidas.map((g) => ({
      gameId: g.id,
      startedAt: g.startedAt,
      endedAt: g.endedAt,
      mode: g.mode,
      difficulty: g.difficulty,
      white: { type: g.whiteType, alias: g.whiteAlias },
      black: { type: g.blackType, alias: g.blackAlias },
      status: g.status,
      result: g.result,
      endReason: g.endReason,
      totalMoves: g.totalMoves,
    }));
  }

  async obtenerPartida(id) {
    const game = await this.store.games.findById(id);
    if (!game) throw new NotFoundError('La partida no existe');
    const moves = await this.store.moves.findByGameId(id);
    return {
      gameId: game.id,
      mode: game.mode,
      difficulty: game.difficulty,
      white: { type: game.whiteType, alias: game.whiteAlias },
      black: { type: game.blackType, alias: game.blackAlias },
      status: game.status,
      result: game.result,
      endReason: game.endReason,
      fen: game.currentFen,
      startedAt: game.startedAt,
      endedAt: game.endedAt,
      moves: moves.map((m) => ({ ply: m.moveNumber, color: m.color, san: m.san, uci: m.uci, fen: m.fenAfter })),
    };
  }

  /** Exportación PGN (sirve para el visor y para el caso de uso de soporte "exportar" pedido en C9) */
  async obtenerPGN(id) {
    const game = await this.store.games.findById(id);
    if (!game) throw new NotFoundError('La partida no existe');
    const moves = await this.store.moves.findByGameId(id);

    const chess = new Chess();
    const fecha = new Date(game.startedAt).toISOString().slice(0, 10).replaceAll('-', '.');
    chess.setHeader('Event', `Ajedrez UNViMe - ${game.mode}`);
    chess.setHeader('Site', 'Local');
    chess.setHeader('Date', fecha);
    chess.setHeader('White', game.whiteAlias || 'Blancas');
    chess.setHeader('Black', game.blackAlias || 'Negras');
    chess.setHeader('Result', PGN_RESULT[game.result] || '*');
    if (game.difficulty) chess.setHeader('Difficulty', game.difficulty);
    if (game.endReason) chess.setHeader('Termination', game.endReason);
    for (const m of moves) chess.move(m.san);
    return chess.pgn();
  }
}

module.exports = ServicioHistorial;
