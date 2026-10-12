'use strict';

const OpponentStrategy = require('./OpponentStrategy');

/**
 * Oponente Stockfish (CU-03). La comunicación UCI vive en StockfishAdapter.
 * Esta clase solo traduce el perfil de dificultad a opciones del motor.
 */
class StockfishOpponent extends OpponentStrategy {
  constructor({ adapter, skillLevel, searchDepth = null, timeLimitMs = 1000 }) {
    super();
    this.adapter = adapter;
    this.skillLevel = skillLevel;
    this.searchDepth = searchDepth;
    this.timeLimitMs = timeLimitMs;
  }

  async getNextMove(fen) {
    return this.adapter.getBestMove(fen, {
      skillLevel: this.skillLevel,
      searchDepth: this.searchDepth,
      timeLimitMs: this.timeLimitMs,
    });
  }

  /**
   * No cierra el adaptador: el proceso de Stockfish es compartido por todas las partidas y se
   * reutiliza entre jugadas. Lo cierra el servidor al apagarse (server.js).
   */
  async dispose() {}
}

module.exports = StockfishOpponent;
