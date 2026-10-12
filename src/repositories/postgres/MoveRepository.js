'use strict';

const { toMove } = require('../../models/mappers');

class MoveRepository {
  constructor(db) {
    this.db = db;
  }

  async create(params) {
    const { rows } = await this.db.query(
      `INSERT INTO moves (game_id, move_number, color, san, uci, fen_before, fen_after, eval_score, timestamp_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        params.gameId,
        params.moveNumber,
        params.color,
        params.san,
        params.uci,
        params.fenBefore,
        params.fenAfter,
        params.evalScore ?? null,
        params.timestampMs ?? null,
      ],
    );
    return toMove(rows[0]);
  }

  async findByGameId(gameId) {
    const { rows } = await this.db.query('SELECT * FROM moves WHERE game_id = $1 ORDER BY move_number', [gameId]);
    return rows.map(toMove);
  }
}

module.exports = MoveRepository;
