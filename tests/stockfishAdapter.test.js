'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { Chess } = require('chess.js');
const StockfishAdapter = require('../src/engines/StockfishAdapter');
const createApp = require('../src/app');
const InMemoryStore = require('../src/repositories/InMemoryStore');
const { FakeAI } = require('./helpers');
const { EngineTimeoutError, EngineUnavailableError } = require('../src/errors');

const FAKE = path.join(__dirname, 'fixtures', 'fake-uci-engine.js');
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** Crea un adaptador contra el motor falso en el modo indicado. */
function fake(t, mode = 'ok', opts = {}) {
  const logFile = path.join(os.tmpdir(), `fake-uci-${process.pid}-${Math.random().toString(36).slice(2)}.log`);
  process.env.FAKE_UCI_MODE = mode;
  process.env.FAKE_UCI_LOG = logFile;
  const adapter = new StockfishAdapter({ binaryPath: FAKE, timeoutMs: 1500, startupTimeoutMs: 2000, ...opts });
  t.after(async () => {
    await adapter.dispose();
    fs.rmSync(logFile, { force: true });
  });
  return { adapter, comandos: () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').trim().split('\n') : []) };
}

test('devuelve la jugada en UCI y manda la secuencia UCI correcta', async (t) => {
  const { adapter, comandos } = fake(t);
  const jugada = await adapter.getBestMove(START, { skillLevel: 10, timeLimitMs: 400 });
  assert.match(jugada, /^[a-h][1-8][a-h][1-8][qrbn]?$/);
  assert.deepEqual(comandos(), [
    'uci',
    'setoption name Skill Level value 10',
    'isready',
    `position fen ${START}`,
    'go movetime 400',
  ]);
});

test('reutiliza el mismo proceso entre jugadas (uci una sola vez)', async (t) => {
  const { adapter, comandos } = fake(t);
  await adapter.getBestMove(START, { skillLevel: 3 });
  await adapter.getBestMove(START, { skillLevel: 20, searchDepth: 8 });
  assert.equal(comandos().filter((c) => c === 'uci').length, 1);
  assert.ok(comandos().includes('setoption name Skill Level value 20'));
  assert.ok(comandos().some((c) => /^go depth 8 movetime \d+$/.test(c)));
});

test('pedidos simultáneos se atienden de a uno', async (t) => {
  const { adapter, comandos } = fake(t);
  const fens = [START, 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'];
  const jugadas = await Promise.all(fens.map((f) => adapter.getBestMove(f, { skillLevel: 5 })));
  // Cada jugada es legal en SU posición (no se mezclaron las respuestas)
  jugadas.forEach((j, i) => assert.ok(new Chess(fens[i]).move(j)));
  const gos = comandos().map((c, i) => (c.startsWith('go') ? i : -1)).filter((i) => i >= 0);
  assert.equal(gos.length, 2);
});

test('el tiempo de búsqueda nunca supera el timeout defensivo', async (t) => {
  const { adapter, comandos } = fake(t, 'ok', { timeoutMs: 1000 });
  await adapter.getBestMove(START, { timeLimitMs: 5000 });
  assert.ok(comandos().includes('go movetime 500'));
});

test('Skill Level fuera de rango se acota a 0..20', async (t) => {
  const { adapter, comandos } = fake(t);
  await adapter.getBestMove(START, { skillLevel: 99 });
  assert.ok(comandos().includes('setoption name Skill Level value 20'));
});

test('timeout: lanza EngineTimeoutError y el próximo pedido reinicia el motor', async (t) => {
  const { adapter, comandos } = fake(t, 'slow', { timeoutMs: 600 });
  await assert.rejects(adapter.getBestMove(START, { timeLimitMs: 100 }), EngineTimeoutError);
  process.env.FAKE_UCI_MODE = 'ok';
  const jugada = await adapter.getBestMove(START, { timeLimitMs: 100 });
  assert.ok(jugada);
  assert.equal(comandos().filter((c) => c === 'uci').length, 2, 'se abrió un proceso nuevo');
});

test('motor que se cae: EngineUnavailableError y luego se recupera', async (t) => {
  const { adapter } = fake(t, 'crash');
  await assert.rejects(adapter.getBestMove(START, {}), EngineUnavailableError);
  process.env.FAKE_UCI_MODE = 'ok';
  assert.ok(await adapter.getBestMove(START, {}));
});

test('motor que no arranca: EngineUnavailableError', async (t) => {
  const { adapter } = fake(t, 'mute', { startupTimeoutMs: 500 });
  await assert.rejects(adapter.getBestMove(START, {}), EngineUnavailableError);
});

test('ruta inexistente o sin configurar: EngineUnavailableError con mensaje claro', async () => {
  const noExiste = new StockfishAdapter({ binaryPath: './bin/no-existe.exe' });
  await assert.rejects(noExiste.getBestMove(START, {}), (err) => {
    assert.ok(err instanceof EngineUnavailableError);
    assert.match(err.message, /STOCKFISH_PATH/);
    return true;
  });
  await assert.rejects(new StockfishAdapter({}).getBestMove(START, {}), /no está configurado/);
});

test('API: partida contra Stockfish con el adaptador real (motor falso)', async (t) => {
  const { adapter } = fake(t);
  const app = createApp({ store: new InMemoryStore(), stockfishAdapter: adapter, aiServiceAdapter: new FakeAI() });
  const c = await request(app).post('/games').send({ mode: 'STOCKFISH', alias: 'G', difficulty: 'FACIL', playerColor: 'BLACK' });
  const e = await request(app).post(`/games/${c.body.gameId}/engine-move`);
  assert.equal(e.status, 200, JSON.stringify(e.body));
  assert.equal(e.body.move.color, 'WHITE');
  assert.equal(e.body.machineTurn, false);
});

// ── Con Stockfish de verdad: STOCKFISH_TEST_PATH=ruta\al\stockfish.exe pnpm test ──
const REAL = process.env.STOCKFISH_TEST_PATH;
test('Stockfish real: juega una partida corta contra sí mismo', { skip: !REAL && 'definí STOCKFISH_TEST_PATH' }, async (t) => {
  const adapter = new StockfishAdapter({ binaryPath: REAL, timeoutMs: 3000, startupTimeoutMs: 30000 });
  t.after(() => adapter.dispose());
  const chess = new Chess();
  for (let i = 0; i < 6; i++) {
    const uci = await adapter.getBestMove(chess.fen(), { skillLevel: i % 2 ? 20 : 3, timeLimitMs: 200 });
    assert.ok(chess.move(uci), `jugada ilegal de Stockfish: ${uci}`);
  }
  // Mate en 1: Stockfish a nivel máximo lo tiene que encontrar
  const mate = await adapter.getBestMove('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', { skillLevel: 20, timeLimitMs: 500 });
  assert.equal(mate, 'd1d8');
});
