'use strict';

const { toProfile } = require('../../models/mappers');

class DifficultyProfileRepository {
  constructor(db) {
    this.db = db;
  }

  async findAll() {
    const { rows } = await this.db.query(
      `SELECT * FROM difficulty_profiles
       ORDER BY engine_type, CASE name WHEN 'FACIL' THEN 1 WHEN 'MEDIO' THEN 2 ELSE 3 END`,
    );
    return rows.map(toProfile);
  }

  async findById(id) {
    const { rows } = await this.db.query('SELECT * FROM difficulty_profiles WHERE id = $1', [id]);
    return toProfile(rows[0]);
  }

  async findByEngineAndName(engineType, name) {
    const { rows } = await this.db.query(
      'SELECT * FROM difficulty_profiles WHERE engine_type = $1 AND name = $2',
      [engineType, name],
    );
    return toProfile(rows[0]);
  }
}

module.exports = DifficultyProfileRepository;
