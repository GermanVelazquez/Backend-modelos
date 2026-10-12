'use strict';

/**
 * Ejecuta los archivos de db/migrations en orden y registra cuáles ya corrieron.
 * Uso: pnpm migrate   (lee DATABASE_URL del .env)
 */
require('dotenv').config({ quiet: true });
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

async function migrate(databaseUrl) {
  const pool = new Pool({ connectionString: databaseUrl });
  const dir = path.join(__dirname, '..', '..', 'db', 'migrations');
  const archivos = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    for (const archivo of archivos) {
      const { rowCount } = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [archivo]);
      if (rowCount) continue;
      await client.query('BEGIN');
      try {
        await client.query(fs.readFileSync(path.join(dir, archivo), 'utf8'));
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [archivo]);
        await client.query('COMMIT');
        console.log(`Migración aplicada: ${archivo}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Falló ${archivo}: ${err.message}`);
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL es obligatoria');
    process.exit(1);
  }
  migrate(process.env.DATABASE_URL)
    .then(() => console.log('Migraciones al día.'))
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}

module.exports = { migrate };
