'use strict';

/**
 * Pruebas contra un PostgreSQL real. Requieren TEST_DATABASE_URL apuntando a una base VACÍA de prueba
 * (se borran sus tablas). Ejemplo:
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/ajedrez_test npm run test:integration
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { Pool } = require('pg');
const { migrate } = require('../../src/db/migrate');
const PostgresStore = require('../../src/repositories/PostgresStore');
const createApp = require('../../src/app');
const { FakeStockfish, FakeAI } = require('../helpers');
const { ConcurrentMoveError } = require('../../src/errors');

const url = process.env.TEST_DATABASE_URL;

test('integración con PostgreSQL', { skip: !url && 'definí TEST_DATABASE_URL para correrlas' }, async (t) => {
  const pool = new Pool({ connectionString: url });
  await pool.query(`DROP VIEW IF EXISTS v_training_moves;
    DROP TABLE IF EXISTS moves, games, difficulty_profiles, ai_model_versions, schema_migrations CASCADE`);
  await migrate(url);
  await migrate(url); // idempotente: la segunda vez no hace nada

  const store = new PostgresStore(pool);
  const app = createApp({ store, stockfishAdapter: new FakeStockfish(), aiServiceAdapter: new FakeAI() });
  const mover = (id, uci) =>
    request(app).post(`/games/${id}/moves`).send({ from: uci.slice(0, 2), to: uci.slice(2, 4) });

  await t.test('perfiles sembrados', async () => {
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM difficulty_profiles');
    assert.equal(rows[0].n, 6);
  });

  let localId;
  await t.test('partida LOCAL completa se persiste jugada a jugada', async () => {
    const c = await request(app).post('/games').send({ mode: 'LOCAL', whiteAlias: 'Ana', blackAlias: 'Beto' });
    assert.equal(c.status, 201);
    localId = c.body.gameId;
    for (const uci of ['f2f3', 'e7e5', 'g2g4', 'd8h4']) assert.equal((await mover(localId, uci)).status, 200);
    const { rows } = await pool.query('SELECT status, result, end_reason, ended_at, white_alias FROM games WHERE id = $1', [localId]);
    assert.equal(rows[0].status, 'FINISHED');
    assert.equal(rows[0].result, 'BLACK_WINS');
    assert.equal(rows[0].end_reason, 'CHECKMATE');
    assert.ok(rows[0].ended_at);
    assert.equal(rows[0].white_alias, 'Ana');
  });

  await t.test('fen_before_key guarda el FEN simplificado de 4 campos', async () => {
    const { rows } = await pool.query('SELECT fen_before, fen_before_key FROM moves WHERE game_id = $1 AND move_number = 1', [localId]);
    assert.equal(rows[0].fen_before_key, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -');
  });

  await t.test('v_training_moves solo incluye partidas finalizadas', async () => {
    const c = await request(app).post('/games').send({ mode: 'STOCKFISH', alias: 'G', difficulty: 'MEDIO', playerColor: 'WHITE' });
    await mover(c.body.gameId, 'e2e4');
    const { rows } = await pool.query('SELECT DISTINCT game_id FROM v_training_moves');
    assert.deepEqual(rows.map((r) => r.game_id), [localId]);

    const e = await request(app).post(`/games/${c.body.gameId}/engine-move`);
    assert.equal(e.status, 200);
    const h = await request(app).get('/games?mode=STOCKFISH');
    assert.equal(h.body[0].difficulty, 'MEDIO');
    assert.equal(h.body[0].totalMoves, 2);
  });

  await t.test('pausa y reanudación reconstruyen el tablero desde la base', async () => {
    const c = await request(app).post('/games').send({ mode: 'LOCAL' });
    const id = c.body.gameId;
    const m = await mover(id, 'd2d4');
    await request(app).post(`/games/${id}/pause`);
    const r = await request(app).post(`/games/${id}/resume`);
    assert.equal(r.body.fen, m.body.fen);
    assert.equal(r.body.turn, 'BLACK');
  });

  await t.test('la base rechaza una jugada duplicada (pedidos simultáneos)', async () => {
    const c = await request(app).post('/games').send({ mode: 'LOCAL' });
    await mover(c.body.gameId, 'e2e4');
    const [m] = await store.moves.findByGameId(c.body.gameId);
    await assert.rejects(
      store.transaction(async (tx) => {
        await tx.games.updateCurrentFen(c.body.gameId, 'x');
        await tx.moves.create({ ...m, moveNumber: 1 });
      }),
      ConcurrentMoveError,
    );
    // rollback: el FEN no cambió a 'x'
    const g = await store.games.findById(c.body.gameId);
    assert.equal(g.currentFen, m.fenAfter);
  });

  await t.test('CHECK: una partida no puede quedar FINISHED sin resultado', async () => {
    const c = await request(app).post('/games').send({ mode: 'LOCAL' });
    await assert.rejects(pool.query(`UPDATE games SET status = 'FINISHED' WHERE id = $1`, [c.body.gameId]));
  });

  await pool.end();
});
