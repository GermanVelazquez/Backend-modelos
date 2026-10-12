'use strict';

const OpponentStrategy = require('./OpponentStrategy');
const { NotYourTurnError } = require('../errors');

/** El humano no calcula jugadas: mueve desde la interfaz con POST /games/:id/moves. */
class HumanOpponent extends OpponentStrategy {
  async getNextMove() {
    throw new NotYourTurnError('Es el turno de un jugador humano: la jugada se envía con POST /games/:id/moves');
  }
}

module.exports = HumanOpponent;
