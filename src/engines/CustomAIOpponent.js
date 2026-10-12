'use strict';

const OpponentStrategy = require('./OpponentStrategy');

/**
 * IA propia (CU-04). Pide la jugada al microservicio Python (POST /predict-move).
 *
 * Fallback (RN-02 y decisión de Diseño Técnico): si el servicio responde source "none"
 * (no hay jugadas históricas ni de apertura para esa posición), se delega en Stockfish con
 * Skill Level mínimo. Lo hace el backend Node, así el servicio Python no necesita Stockfish.
 * Por eso esta clase recibe además un `fallback` (un StockfishOpponent), que en el diagrama faltaba.
 */
class CustomAIOpponent extends OpponentStrategy {
  constructor({ adapter, fallback, difficulty, eloMin = null, eloMax = null }) {
    super();
    this.adapter = adapter;
    this.fallback = fallback;
    this.difficulty = difficulty;
    this.eloMin = eloMin;
    this.eloMax = eloMax;
    /** Origen de la última jugada: "history" | "openings" | "fallback" (útil para logs y QA) */
    this.lastSource = null;
  }

  async getNextMove(fen, context = {}) {
    const respuesta = await this.adapter.predictMove(fen, {
      gameId: context.gameId,
      difficulty: this.difficulty,
      elo: this.eloMin,
    });
    if (respuesta && respuesta.move && respuesta.source !== 'none') {
      this.lastSource = respuesta.source;
      return respuesta.move;
    }
    this.lastSource = 'fallback';
    return this.fallback.getNextMove(fen, context);
  }

  async dispose() {
    if (this.fallback) await this.fallback.dispose();
  }
}

module.exports = CustomAIOpponent;
