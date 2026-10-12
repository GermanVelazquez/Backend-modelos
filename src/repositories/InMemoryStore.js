'use strict';

const { randomUUID } = require('node:crypto');
const { ConcurrentMoveError } = require('../errors');

/**
 * Implementación en memoria con la MISMA interfaz que PostgresStore.
 * Sirve para las pruebas unitarias (no necesitan base de datos) y para levantar el backend
 * sin Postgres con STORE=memory. No usar en producción: al reiniciar se pierde todo.
 */
const DEFAULT_PROFILES = [
  ['FACIL', 'STOCKFISH', 3, 800, 1200],
  ['MEDIO', 'STOCKFISH', 10, 1300, 1700],
  ['DIFICIL', 'STOCKFISH', 20, 1800, null],
  ['FACIL', 'AI', null, 800, 1200],
  ['MEDIO', 'AI', null, 1300, 1700],
  ['DIFICIL', 'AI', null, 1800, null],
].map(([name, engineType, skillLevel, eloMin, eloMax]) => ({
  id: randomUUID(),
  name,
  engineType,
  skillLevel,
  searchDepth: null,
  timeLimitMs: 1000,
  eloMin,
  eloMax,
}));

class InMemoryStore {
  constructor() {
    const games = new Map();
    const moves = [];
    const profiles = DEFAULT_PROFILES.map((p) => ({ ...p }));
    const clone = (o) => (o ? structuredClone(o) : null);

    const withExtras = (g) => {
      const profile = profiles.find((p) => p.id === g.difficultyProfileId);
      return {
        ...clone(g),
        difficulty: profile ? profile.name : null,
        totalMoves: moves.filter((m) => m.gameId === g.id).length,
      };
    };

    this.games = {
      async create(params) {
        const game = {
          id: randomUUID(),
          ...params,
          result: null,
          endReason: null,
          startedAt: new Date(),
          endedAt: null,
        };
        games.set(game.id, game);
        return withExtras(game);
      },
      async findById(id) {
        const g = games.get(id);
        return g ? withExtras(g) : null;
      },
      async findAll(filters = {}) {
        const alias = filters.alias ? filters.alias.toLowerCase() : null;
        return [...games.values()]
          .map(withExtras)
          .filter((g) => g.source === 'USER')
          .filter((g) => !filters.mode || g.mode === filters.mode)
          .filter((g) => !filters.difficulty || g.difficulty === filters.difficulty)
          .filter((g) => !filters.status || g.status === filters.status)
          .filter((g) => !filters.result || g.result === filters.result)
          .filter(
            (g) =>
              !alias ||
              (g.whiteAlias || '').toLowerCase().includes(alias) ||
              (g.blackAlias || '').toLowerCase().includes(alias),
          )
          .sort((a, b) => b.startedAt - a.startedAt)
          .slice(filters.offset ?? 0, (filters.offset ?? 0) + (filters.limit ?? 50));
      },
      async updateCurrentFen(id, fen) {
        games.get(id).currentFen = fen;
      },
      async updateStatus(id, status) {
        games.get(id).status = status;
      },
      async updateResult(id, { result, endReason, endedAt = new Date() }) {
        Object.assign(games.get(id), { status: 'FINISHED', result, endReason, endedAt });
      },
    };

    this.moves = {
      async create(params) {
        if (moves.some((m) => m.gameId === params.gameId && m.moveNumber === params.moveNumber)) {
          throw new ConcurrentMoveError();
        }
        const move = { id: randomUUID(), evalScore: null, timestampMs: null, ...params, createdAt: new Date() };
        moves.push(move);
        return clone(move);
      },
      async findByGameId(gameId) {
        return moves
          .filter((m) => m.gameId === gameId)
          .sort((a, b) => a.moveNumber - b.moveNumber)
          .map(clone);
      },
    };

    this.profiles = {
      async findAll() {
        return profiles.map(clone);
      },
      async findById(id) {
        return clone(profiles.find((p) => p.id === id));
      },
      async findByEngineAndName(engineType, name) {
        return clone(profiles.find((p) => p.engineType === engineType && p.name === name));
      },
    };

    // Snapshot/restore simple para emular el rollback de una transacción.
    this._snapshot = () => ({ games: structuredClone([...games.entries()]), moves: structuredClone(moves) });
    this._restore = (s) => {
      games.clear();
      for (const [k, v] of s.games) games.set(k, v);
      moves.length = 0;
      moves.push(...s.moves);
    };
  }

  async transaction(fn) {
    const snapshot = this._snapshot();
    try {
      return await fn({ games: this.games, moves: this.moves });
    } catch (err) {
      this._restore(snapshot);
      throw err;
    }
  }

  async ping() {}
}

module.exports = InMemoryStore;
