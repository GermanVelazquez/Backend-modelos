'use strict';

const { Chess } = require('chess.js');
const createApp = require('../src/app');
const InMemoryStore = require('../src/repositories/InMemoryStore');
const { EngineTimeoutError } = require('../src/errors');

/** Stockfish falso: juega la primera jugada legal (o la que se le indique), o simula un timeout. */
class FakeStockfish {
  constructor() {
    this.calls = [];
    this.mode = 'ok';
    this.forced = null;
  }
  async getBestMove(fen, options) {
    this.calls.push({ fen, options });
    if (this.mode === 'timeout') throw new EngineTimeoutError('Stockfish');
    if (this.forced) return this.forced;
    return new Chess(fen).moves({ verbose: true })[0].lan;
  }
  async dispose() {}
}

/** Servicio de IA falso */
class FakeAI {
  constructor() {
    this.calls = [];
    this.response = null; // null -> { move: primera legal, source: 'history' }
  }
  async predictMove(fen, ctx) {
    this.calls.push({ fen, ctx });
    if (this.response) return this.response;
    return { move: new Chess(fen).moves({ verbose: true })[0].lan, source: 'history' };
  }
}

function buildApp(store = new InMemoryStore()) {
  const stockfish = new FakeStockfish();
  const ai = new FakeAI();
  const app = createApp({ store, stockfishAdapter: stockfish, aiServiceAdapter: ai });
  return { app, store, stockfish, ai };
}

module.exports = { buildApp, FakeStockfish, FakeAI };
