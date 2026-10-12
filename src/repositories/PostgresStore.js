'use strict';

const GameRepository = require('./postgres/GameRepository');
const MoveRepository = require('./postgres/MoveRepository');
const DifficultyProfileRepository = require('./postgres/DifficultyProfileRepository');
const { ConcurrentMoveError } = require('../errors');

/**
 * Agrupa los repositorios y ofrece transacciones.
 * La persistencia queda separada de la lógica de cada jugada (corrección C10 del profesor):
 * GestorDePartida decide QUÉ guardar y esta capa decide CÓMO.
 */
class PostgresStore {
  constructor(pool) {
    this.pool = pool;
    this.games = new GameRepository(pool);
    this.moves = new MoveRepository(pool);
    this.profiles = new DifficultyProfileRepository(pool);
  }

  /** Ejecuta `fn` dentro de una transacción. Todo se confirma junto o no se guarda nada. */
  async transaction(fn) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn({
        games: new GameRepository(client),
        moves: new MoveRepository(client),
      });
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      // 23505 = unique_violation sobre (game_id, move_number): otra jugada se guardó primero.
      if (err && err.code === '23505') throw new ConcurrentMoveError();
      throw err;
    } finally {
      client.release();
    }
  }

  async ping() {
    await this.pool.query('SELECT 1');
  }
}

module.exports = PostgresStore;
