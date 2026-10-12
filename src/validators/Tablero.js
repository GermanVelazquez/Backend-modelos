'use strict';

const { Chess } = require('chess.js');
const { GameResult, EndReason, Color, START_FEN } = require('../models/constants');
const { IllegalMoveError, PromotionRequiredError } = require('../errors');

/**
 * Fachada (patrón Facade) sobre chess.js. El resto del backend nunca usa chess.js directamente:
 * si mañana se cambia la librería de reglas, solo cambia esta clase.
 *
 * Importante: la triple repetición necesita el historial de posiciones, que el FEN solo no tiene.
 * Por eso, al reanudar o recargar una partida, el tablero se reconstruye con `desdeJugadas()`
 * repitiendo todas las jugadas desde la posición inicial.
 */
class Tablero {
  constructor(fen = START_FEN) {
    this.chess = new Chess(fen);
  }

  /**
   * Reconstruye el tablero aplicando las jugadas guardadas en orden.
   * @param {Array<{uci?: string, san: string}>} jugadas
   */
  static desdeJugadas(jugadas, fenInicial = START_FEN) {
    const tablero = new Tablero(fenInicial);
    for (const jugada of jugadas) {
      const movimiento = jugada.uci ? Tablero.parsearUci(jugada.uci) : jugada.san;
      tablero.chess.move(movimiento);
    }
    return tablero;
  }

  /** "e7e8q" -> { from: 'e7', to: 'e8', promotion: 'q' } */
  static parsearUci(uci) {
    const match = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(String(uci || '').trim().toLowerCase());
    if (!match) return null;
    const jugada = { from: match[1], to: match[2] };
    if (match[3]) jugada.promotion = match[3];
    return jugada;
  }

  fen() {
    return this.chess.fen();
  }

  /** Color que tiene el turno: 'WHITE' | 'BLACK' */
  turno() {
    return this.chess.turn() === 'w' ? Color.WHITE : Color.BLACK;
  }

  estaEnJaque() {
    return this.chess.isCheck();
  }

  /** Casillas destino legales para la pieza en `casilla` (CU-06 paso 1: resaltar destinos) */
  obtenerMovimientosLegales(casilla) {
    return this.chess.moves({ square: casilla, verbose: true }).map((m) => ({
      from: m.from,
      to: m.to,
      san: m.san,
      promotion: Boolean(m.promotion),
      capture: Boolean(m.captured),
    }));
  }

  /** ¿La jugada from->to es un peón llegando a la última fila? */
  esPromocion(from, to) {
    return this.chess.moves({ square: from, verbose: true }).some((m) => m.to === to && Boolean(m.promotion));
  }

  validarMovimientoLegal(from, to) {
    return this.chess.moves({ square: from, verbose: true }).some((m) => m.to === to);
  }

  /**
   * Aplica una jugada si es legal (RN-02 Bis). Si no lo es, no modifica el tablero.
   * @returns {{san, uci, color, fenBefore, fenAfter}}
   */
  aplicarJugada({ from, to, promotion }) {
    if (!this.validarMovimientoLegal(from, to)) {
      throw new IllegalMoveError(`La jugada ${from}-${to} no es legal en esta posición`);
    }
    const esPromocion = this.esPromocion(from, to);
    if (esPromocion && !promotion) throw new PromotionRequiredError();

    const movimiento = { from, to };
    if (esPromocion) movimiento.promotion = promotion;

    let resultado;
    try {
      resultado = this.chess.move(movimiento);
    } catch {
      throw new IllegalMoveError(`La jugada ${from}-${to} no es legal en esta posición`);
    }
    return {
      san: resultado.san,
      uci: resultado.lan,
      color: resultado.color === 'w' ? Color.WHITE : Color.BLACK,
      fenBefore: resultado.before,
      fenAfter: resultado.after,
    };
  }

  detectarJaqueMate() {
    return this.chess.isCheckmate();
  }

  detectarAhogado() {
    return this.chess.isStalemate();
  }

  detectarTablasMaterial() {
    return this.chess.isInsufficientMaterial();
  }

  detectarTripleRepeticion() {
    return this.chess.isThreefoldRepetition();
  }

  detectarRegla50Movimientos() {
    return this.chess.isDrawByFiftyMoves();
  }

  /**
   * Evalúa las condiciones de fin de RN-03 sobre la posición actual.
   * @returns {null | {result: string, endReason: string}}
   */
  evaluarFin() {
    if (this.detectarJaqueMate()) {
      // Si el bando con el turno está en mate, gana el otro.
      const result = this.turno() === Color.WHITE ? GameResult.BLACK_WINS : GameResult.WHITE_WINS;
      return { result, endReason: EndReason.CHECKMATE };
    }
    if (this.detectarAhogado()) return { result: GameResult.DRAW, endReason: EndReason.STALEMATE };
    if (this.detectarTablasMaterial()) return { result: GameResult.DRAW, endReason: EndReason.INSUFFICIENT_MATERIAL };
    if (this.detectarTripleRepeticion()) return { result: GameResult.DRAW, endReason: EndReason.THREEFOLD_REPETITION };
    if (this.detectarRegla50Movimientos()) return { result: GameResult.DRAW, endReason: EndReason.FIFTY_MOVES };
    return null;
  }
}

module.exports = Tablero;
