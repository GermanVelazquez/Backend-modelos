'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { buildApp } = require('./helpers');

async function nuevaLocal(app) {
  const res = await request(app).post('/games').send({ mode: 'LOCAL', whiteAlias: 'Ana', blackAlias: 'Beto' });
  assert.equal(res.status, 201);
  return res.body.gameId;
}

async function mover(app, id, uci, esperado = 200) {
  const body = { from: uci.slice(0, 2), to: uci.slice(2, 4) };
  if (uci[4]) body.promotion = uci[4];
  const res = await request(app).post(`/games/${id}/moves`).send(body);
  assert.equal(res.status, esperado, JSON.stringify(res.body));
  return res.body;
}

// ───────────── Infraestructura ─────────────

test('GET /health', async () => {
  const { app } = buildApp();
  const res = await request(app).get('/health');
  assert.deepEqual(res.body, { status: 'ok', database: 'up' });
});

test('GET /difficulty-profiles devuelve los 6 perfiles con rango ELO', async () => {
  const { app } = buildApp();
  const res = await request(app).get('/difficulty-profiles');
  assert.equal(res.body.length, 6);
  const medio = res.body.find((p) => p.engineType === 'STOCKFISH' && p.name === 'MEDIO');
  assert.equal(medio.eloMin, 1300);
  assert.equal(medio.eloMax, 1700);
  assert.equal(medio.skillLevel, undefined, 'no se exponen detalles internos del motor');
});

test('JSON mal formado y ruta inexistente', async () => {
  const { app } = buildApp();
  const r1 = await request(app).post('/games').set('Content-Type', 'application/json').send('{mal');
  assert.equal(r1.status, 400);
  assert.equal(r1.body.error.code, 'INVALID_JSON');
  const r2 = await request(app).get('/nada');
  assert.equal(r2.status, 404);
});

// ───────────── CU-01 + CU-02 + CU-06 ─────────────

test('CU-01 crea partida LOCAL en curso con alias de ambos jugadores', async () => {
  const { app } = buildApp();
  const res = await request(app).post('/games').send({ mode: 'LOCAL', whiteAlias: 'Ana', blackAlias: 'Beto' });
  assert.equal(res.status, 201);
  assert.equal(res.body.status, 'IN_PROGRESS');
  assert.equal(res.body.turn, 'WHITE');
  assert.equal(res.body.machineTurn, false);
  assert.deepEqual(res.body.white, { type: 'HUMAN', alias: 'Ana' });
  assert.deepEqual(res.body.black, { type: 'HUMAN', alias: 'Beto' });
});

test('CU-01 datos inválidos devuelven 400', async () => {
  const { app } = buildApp();
  const res = await request(app).post('/games').send({ mode: 'AI', playerColor: 'WHITE' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
});

test('CU-06 jugada legal se guarda y alterna el turno', async () => {
  const { app, store } = buildApp();
  const id = await nuevaLocal(app);
  const r = await mover(app, id, 'e2e4');
  assert.equal(r.valid, true);
  assert.equal(r.move.san, 'e4');
  assert.equal(r.turn, 'BLACK');
  const moves = await store.moves.findByGameId(id);
  assert.equal(moves.length, 1);
  assert.equal(moves[0].uci, 'e2e4');
  const game = await store.games.findById(id);
  assert.equal(game.currentFen, r.fen);
});

test('CU-06 2a jugada ilegal: 422, valid=false y nada se guarda', async () => {
  const { app, store } = buildApp();
  const id = await nuevaLocal(app);
  const r = await mover(app, id, 'e2e5', 422);
  assert.equal(r.valid, false);
  assert.equal(r.error.code, 'ILLEGAL_MOVE');
  assert.equal((await store.moves.findByGameId(id)).length, 0);
});

test('CU-06 mover pieza del rival no es legal', async () => {
  const { app } = buildApp();
  const id = await nuevaLocal(app);
  const r = await mover(app, id, 'e7e5', 422);
  assert.equal(r.error.code, 'ILLEGAL_MOVE');
});

test('GET legal-moves devuelve destinos', async () => {
  const { app } = buildApp();
  const id = await nuevaLocal(app);
  const res = await request(app).get(`/games/${id}/legal-moves?square=b1`);
  assert.deepEqual(res.body.moves.map((m) => m.to).sort(), ['a3', 'c3']);
  const malo = await request(app).get(`/games/${id}/legal-moves?square=z9`);
  assert.equal(malo.status, 400);
});

test('RN-03 jaque mate finaliza la partida y bloquea nuevas jugadas', async () => {
  const { app } = buildApp();
  const id = await nuevaLocal(app);
  let r;
  for (const uci of ['f2f3', 'e7e5', 'g2g4', 'd8h4']) r = await mover(app, id, uci);
  assert.equal(r.status, 'FINISHED');
  assert.equal(r.result, 'BLACK_WINS');
  assert.equal(r.endReason, 'CHECKMATE');
  assert.ok(r.endedAt);
  const otra = await mover(app, id, 'a2a3', 409);
  assert.equal(otra.error.code, 'INVALID_STATE');
});

test('RN-03 triple repetición declara tablas', async () => {
  const { app } = buildApp();
  const id = await nuevaLocal(app);
  let r;
  for (const uci of ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8']) r = await mover(app, id, uci);
  assert.equal(r.result, 'DRAW');
  assert.equal(r.endReason, 'THREEFOLD_REPETITION');
});

test('Promoción sin pieza pide elegir (PROMOTION_REQUIRED)', async () => {
  const { app } = buildApp();
  const id = await nuevaLocal(app);
  // Peón blanco llega a b7 capturando y luego intenta coronar en a8 sin indicar pieza
  for (const uci of ['b2b4', 'a7a5', 'b4a5', 'b7b6', 'a5b6', 'c8a6', 'b6b7', 'a6b5']) await mover(app, id, uci);
  const r = await mover(app, id, 'b7a8', 422);
  assert.equal(r.error.code, 'PROMOTION_REQUIRED');
  const ok = await mover(app, id, 'b7a8n');
  assert.equal(ok.move.san, 'bxa8=N');
});

// ───────────── Pausa, reanudación y abandono ─────────────

test('Pausar y reanudar conserva tablero y turno', async () => {
  const { app } = buildApp();
  const id = await nuevaLocal(app);
  const jugado = await mover(app, id, 'd2d4');

  const p = await request(app).post(`/games/${id}/pause`);
  assert.equal(p.body.status, 'PAUSED');
  const bloqueada = await mover(app, id, 'd7d5', 409);
  assert.match(bloqueada.error.message, /pausada/);

  const re = await request(app).post(`/games/${id}/resume`);
  assert.equal(re.body.status, 'IN_PROGRESS');
  assert.equal(re.body.fen, jugado.fen);
  assert.equal(re.body.turn, 'BLACK');
  await mover(app, id, 'd7d5');

  const dos = await request(app).post(`/games/${id}/resume`);
  assert.equal(dos.status, 409);
});

test('Rendirse: gana el rival y la partida queda finalizada', async () => {
  const { app } = buildApp();
  const id = await nuevaLocal(app);
  const r = await request(app).post(`/games/${id}/resign`).send({ color: 'WHITE' });
  assert.equal(r.body.status, 'FINISHED');
  assert.equal(r.body.result, 'BLACK_WINS');
  assert.equal(r.body.endReason, 'RESIGNATION');
  const otra = await request(app).post(`/games/${id}/resign`).send({ color: 'BLACK' });
  assert.equal(otra.status, 409);
});

test('Partida inexistente e id inválido', async () => {
  const { app } = buildApp();
  const r1 = await request(app).get('/games/00000000-0000-4000-8000-000000000000');
  assert.equal(r1.status, 404);
  const r2 = await request(app).get('/games/abc');
  assert.equal(r2.status, 400);
});

// ───────────── CU-03 / CU-04 contra la máquina ─────────────

test('CU-03 humano con blancas: mueve y luego engine-move responde Stockfish', async () => {
  const { app, stockfish } = buildApp();
  const c = await request(app).post('/games').send({ mode: 'STOCKFISH', alias: 'German', difficulty: 'MEDIO', playerColor: 'WHITE' });
  assert.equal(c.body.machineTurn, false);
  assert.deepEqual(c.body.black, { type: 'STOCKFISH', alias: 'Stockfish' });
  const id = c.body.gameId;

  const m = await mover(app, id, 'e2e4');
  assert.equal(m.machineTurn, true);

  // El humano no puede mover en el turno de la máquina
  const fuera = await mover(app, id, 'd2d4', 409);
  assert.equal(fuera.error.code, 'NOT_YOUR_TURN');

  const e = await request(app).post(`/games/${id}/engine-move`);
  assert.equal(e.status, 200, JSON.stringify(e.body));
  assert.equal(e.body.move.color, 'BLACK');
  assert.equal(e.body.turn, 'WHITE');
  assert.equal(stockfish.calls[0].options.skillLevel, 10, 'MEDIO usa Skill Level 10');
});

test('CU-01 4a humano con negras: la máquina debe jugar primero', async () => {
  const { app } = buildApp();
  const c = await request(app).post('/games').send({ mode: 'AI', alias: 'German', difficulty: 'FACIL', playerColor: 'BLACK' });
  assert.equal(c.body.machineTurn, true);
  const humano = await mover(app, c.body.gameId, 'e7e5', 409);
  assert.equal(humano.error.code, 'NOT_YOUR_TURN');
  const e = await request(app).post(`/games/${c.body.gameId}/engine-move`);
  assert.equal(e.body.move.color, 'WHITE');
  assert.equal(e.body.machineTurn, false);
});

test('CU-03 3a timeout del motor: 504 reintentable y no se guarda nada', async () => {
  const { app, stockfish, store } = buildApp();
  const c = await request(app).post('/games').send({ mode: 'STOCKFISH', alias: 'G', difficulty: 'DIFICIL', playerColor: 'BLACK' });
  stockfish.mode = 'timeout';
  const e = await request(app).post(`/games/${c.body.gameId}/engine-move`);
  assert.equal(e.status, 504);
  assert.equal(e.body.error.code, 'ENGINE_TIMEOUT');
  assert.equal(e.body.error.details.retryable, true);
  assert.equal((await store.moves.findByGameId(c.body.gameId)).length, 0);

  stockfish.mode = 'ok'; // reintento
  const ok = await request(app).post(`/games/${c.body.gameId}/engine-move`);
  assert.equal(ok.status, 200);
});

test('Motor que devuelve jugada ilegal: 502 y no se guarda', async () => {
  const { app, stockfish } = buildApp();
  const c = await request(app).post('/games').send({ mode: 'STOCKFISH', alias: 'G', difficulty: 'FACIL', playerColor: 'BLACK' });
  stockfish.forced = 'e2e5';
  const e = await request(app).post(`/games/${c.body.gameId}/engine-move`);
  assert.equal(e.status, 502);
  assert.equal(e.body.error.code, 'ENGINE_BAD_MOVE');
});

test('CU-04 IA propia con jugada histórica no usa Stockfish', async () => {
  const { app, ai, stockfish } = buildApp();
  const c = await request(app).post('/games').send({ mode: 'AI', alias: 'G', difficulty: 'DIFICIL', playerColor: 'BLACK' });
  const e = await request(app).post(`/games/${c.body.gameId}/engine-move`);
  assert.equal(e.status, 200);
  assert.equal(ai.calls.length, 1);
  assert.equal(ai.calls[0].ctx.difficulty, 'DIFICIL');
  assert.equal(ai.calls[0].ctx.gameId, c.body.gameId);
  assert.equal(stockfish.calls.length, 0);
});

test('CU-04 3a fallback: sin datos históricos la IA delega en Stockfish Skill Level 0', async () => {
  const { app, ai, stockfish } = buildApp();
  ai.response = { move: null, source: 'none' };
  const c = await request(app).post('/games').send({ mode: 'AI', alias: 'G', difficulty: 'MEDIO', playerColor: 'BLACK' });
  const e = await request(app).post(`/games/${c.body.gameId}/engine-move`);
  assert.equal(e.status, 200);
  assert.equal(stockfish.calls.length, 1);
  assert.equal(stockfish.calls[0].options.skillLevel, 0);
});

test('engine-move en partida LOCAL no corresponde', async () => {
  const { app } = buildApp();
  const id = await nuevaLocal(app);
  const e = await request(app).post(`/games/${id}/engine-move`);
  assert.equal(e.status, 409);
  assert.equal(e.body.error.code, 'NOT_YOUR_TURN');
});

test('Contra la máquina solo el humano puede rendirse', async () => {
  const { app } = buildApp();
  const c = await request(app).post('/games').send({ mode: 'STOCKFISH', alias: 'G', difficulty: 'FACIL', playerColor: 'WHITE' });
  const mal = await request(app).post(`/games/${c.body.gameId}/resign`).send({ color: 'BLACK' });
  assert.equal(mal.status, 400);
  const ok = await request(app).post(`/games/${c.body.gameId}/resign`).send({ color: 'WHITE' });
  assert.equal(ok.body.result, 'BLACK_WINS');
});

// ───────────── CU-05 Historial ─────────────

test('CU-05 historial con filtros, detalle y PGN', async () => {
  const { app } = buildApp();
  const local = await nuevaLocal(app);
  for (const uci of ['f2f3', 'e7e5', 'g2g4', 'd8h4']) await mover(app, local, uci);
  const sf = await request(app).post('/games').send({ mode: 'STOCKFISH', alias: 'German', difficulty: 'FACIL', playerColor: 'WHITE' });
  await request(app).post(`/games/${sf.body.gameId}/pause`);

  const todas = await request(app).get('/games');
  assert.equal(todas.body.length, 2);

  const pausadas = await request(app).get('/games?status=PAUSED');
  assert.equal(pausadas.body.length, 1);
  assert.equal(pausadas.body[0].difficulty, 'FACIL');

  const porAlias = await request(app).get('/games?alias=germ');
  assert.equal(porAlias.body.length, 1);

  const ganadasNegras = await request(app).get('/games?result=BLACK_WINS&mode=LOCAL');
  assert.equal(ganadasNegras.body[0].totalMoves, 4);

  const detalle = await request(app).get(`/games/${local}`);
  assert.equal(detalle.body.moves.length, 4);
  assert.deepEqual(detalle.body.moves.map((m) => m.san), ['f3', 'e5', 'g4', 'Qh4#']);
  assert.equal(detalle.body.status, 'FINISHED');

  const pgn = await request(app).get(`/games/${local}/pgn`);
  assert.match(pgn.headers['content-type'], /application\/x-chess-pgn/);
  assert.match(pgn.text, /\[White "Ana"\]/);
  assert.match(pgn.text, /\[Result "0-1"\]/);
  assert.match(pgn.text, /1\. f3 e5 2\. g4 Qh4#/);

  const vacio = await request(app).get('/games?mode=AI');
  assert.deepEqual(vacio.body, []);
});

test('CORS: el navegador desde el frontend Vite (5173) puede llamar a la API; otro origen no', async () => {
  const { app } = buildApp();
  const ok = await request(app).options('/games').set('Origin', 'http://localhost:5173').set('Access-Control-Request-Method', 'POST');
  assert.equal(ok.headers['access-control-allow-origin'], 'http://localhost:5173');
  const otro = await request(app).get('/health').set('Origin', 'http://evil.example');
  assert.equal(otro.headers['access-control-allow-origin'], undefined);
});
