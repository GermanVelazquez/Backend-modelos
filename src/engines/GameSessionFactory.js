'use strict';

const { PlayerType } = require('../models/constants');
const { EngineUnavailableError } = require('../errors');
const HumanOpponent = require('./HumanOpponent');
const StockfishOpponent = require('./StockfishOpponent');
const CustomAIOpponent = require('./CustomAIOpponent');

/** Skill Level usado como respaldo de la IA propia (RN-02: "Stockfish a Skill Level mínimo") */
const FALLBACK_SKILL_LEVEL = 0;
const FALLBACK_TIME_MS = 300;

/**
 * Único lugar donde se decide qué oponente concreto se instancia (Arquitectura: GameSessionFactory).
 * El resto del código solo llama a getNextMove() de forma polimórfica.
 */
class GameSessionFactory {
  constructor({ stockfishAdapter, aiServiceAdapter }) {
    this.stockfishAdapter = stockfishAdapter;
    this.aiServiceAdapter = aiServiceAdapter;
  }

  /**
   * @param {string} playerType HUMAN | STOCKFISH | AI (el tipo del bando que tiene el turno)
   * @param {object|null} profile fila de difficulty_profiles
   */
  crearOponente(playerType, profile) {
    switch (playerType) {
      case PlayerType.HUMAN:
        return new HumanOpponent();
      case PlayerType.STOCKFISH:
        this.#exigirPerfil(profile);
        return new StockfishOpponent({
          adapter: this.stockfishAdapter,
          skillLevel: profile.skillLevel,
          searchDepth: profile.searchDepth,
          timeLimitMs: profile.timeLimitMs,
        });
      case PlayerType.AI:
        this.#exigirPerfil(profile);
        return new CustomAIOpponent({
          adapter: this.aiServiceAdapter,
          difficulty: profile.name,
          eloMin: profile.eloMin,
          eloMax: profile.eloMax,
          fallback: new StockfishOpponent({
            adapter: this.stockfishAdapter,
            skillLevel: FALLBACK_SKILL_LEVEL,
            timeLimitMs: FALLBACK_TIME_MS,
          }),
        });
      default:
        throw new EngineUnavailableError(`Tipo de jugador desconocido: ${playerType}`);
    }
  }

  #exigirPerfil(profile) {
    if (!profile) throw new EngineUnavailableError('La partida no tiene perfil de dificultad asociado');
  }
}

module.exports = GameSessionFactory;
