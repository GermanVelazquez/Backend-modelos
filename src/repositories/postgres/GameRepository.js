'use strict';

const { toGame } = require('../../models/mappers');

const SELECT_GAME = `
  SELECT g.*, dp.name AS difficulty,
         (SELECT count(*) FROM moves m WHERE m.game_id = g.id) AS total_moves
  FROM games g
  LEFT JOIN difficulty_profiles dp ON dp.id = g.difficulty_profile_id`;

/** Repositorio de partidas (patrón Repository). `db` es el pool o un cliente dentro de una transacción. */
class GameRepository {
  constructor(db) {
    this.db = db;
  }

  async create(params) {
    const { rows } = await this.db.query(
      `INSERT INTO games (mode, white_type, black_type, white_alias, black_alias,
                         difficulty_profile_id, status, current_fen, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        params.mode,
        params.whiteType,
        params.blackType,
        params.whiteAlias,
        params.blackAlias,
        params.difficultyProfileId,
        params.status,
        params.currentFen,
        params.source,
      ],
    );
    return this.findById(rows[0].id);
  }

  async findById(id) {
    const { rows } = await this.db.query(`${SELECT_GAME} WHERE g.id = $1`, [id]);
    return toGame(rows[0]);
  }

  /** Historial (CU-05) con filtros opcionales: mode, difficulty, status, result, alias */
  async findAll(filters = {}) {
    const where = [];
    const values = [];
    const add = (sql, value) => {
      values.push(value);
      where.push(sql.replaceAll('?', `$${values.length}`));
    };
    if (filters.mode) add('g.mode = ?', filters.mode);
    if (filters.difficulty) add('dp.name = ?', filters.difficulty);
    if (filters.status) add('g.status = ?', filters.status);
    if (filters.result) add('g.result = ?', filters.result);
    if (filters.alias) add('(g.white_alias ILIKE ? OR g.black_alias ILIKE ?)', `%${filters.alias}%`);
    values.push(filters.limit ?? 50, filters.offset ?? 0);
    const sql = `${SELECT_GAME}
      WHERE g.source = 'USER' ${where.length ? 'AND ' + where.join(' AND ') : ''}
      ORDER BY g.started_at DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}`;
    const { rows } = await this.db.query(sql, values);
    return rows.map(toGame);
  }

  async updateCurrentFen(id, fen) {
    await this.db.query('UPDATE games SET current_fen = $2 WHERE id = $1', [id, fen]);
  }

  async updateStatus(id, status) {
    await this.db.query('UPDATE games SET status = $2 WHERE id = $1', [id, status]);
  }

  /** Cierra la partida (RN-03): estado FINISHED + resultado + motivo + fecha de fin */
  async updateResult(id, { result, endReason, endedAt = new Date() }) {
    await this.db.query(
      `UPDATE games SET status = 'FINISHED', result = $2, end_reason = $3, ended_at = $4 WHERE id = $1`,
      [id, result, endReason, endedAt],
    );
  }
}

module.exports = GameRepository;
