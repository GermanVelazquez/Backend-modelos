'use strict';

/**
 * Patrón Strategy: interfaz común de todos los oponentes (Arquitectura 5.1, Diagrama de clases).
 *
 * Corrección propuesta al diagrama: la firma es getNextMove(fen, context) para TODAS las
 * implementaciones. En el diagrama CustomAIOpponent tenía getNextMove(fen, gameId) y la interfaz
 * getNextMove(fen), lo que rompía el polimorfismo. `context` lleva { gameId, profile }.
 *
 * Devuelve la jugada en formato UCI ("e2e4", "e7e8q").
 */
class OpponentStrategy {
  constructor() {
    if (new.target === OpponentStrategy) {
      throw new TypeError('OpponentStrategy es abstracta');
    }
  }

  // eslint-disable-next-line no-unused-vars
  async getNextMove(fen, context) {
    throw new Error('getNextMove() no implementado');
  }

  async dispose() {}
}

module.exports = OpponentStrategy;
