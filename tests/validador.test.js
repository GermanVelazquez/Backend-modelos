'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../src/validators/ValidadorDeJugada');
const { ValidationError } = require('../src/errors');
const { loadConfig } = require('../src/config/env');

// ── Jugada: una prueba por entrada válida e inválida (Manual de Roles, Backend) ──

test('jugada válida simple y con promoción en mayúscula', () => {
  assert.deepEqual(V.validarJugada({ from: 'e2', to: 'e4' }), { from: 'e2', to: 'e4' });
  assert.deepEqual(V.validarJugada({ from: 'A7', to: 'a8', promotion: 'N' }), { from: 'a7', to: 'a8', promotion: 'n' });
});

for (const [nombre, body] of [
  ['sin cuerpo', undefined],
  ['sin from', { to: 'e4' }],
  ['casilla fuera del tablero', { from: 'e9', to: 'e4' }],
  ['casilla con letra inválida', { from: 'z2', to: 'e4' }],
  ['from igual a to', { from: 'e2', to: 'e2' }],
  ['promoción a rey', { from: 'a7', to: 'a8', promotion: 'k' }],
  ['promoción con nombre largo', { from: 'a7', to: 'a8', promotion: 'queen' }],
]) {
  test(`jugada inválida: ${nombre}`, () => {
    assert.throws(() => V.validarJugada(body), ValidationError);
  });
}

// ── Nueva partida ──

test('nueva partida LOCAL usa alias por defecto', () => {
  assert.deepEqual(V.validarNuevaPartida({ mode: 'local' }), { mode: 'LOCAL', whiteAlias: 'Blancas', blackAlias: 'Negras' });
});

test('nueva partida contra la máquina', () => {
  assert.deepEqual(
    V.validarNuevaPartida({ mode: 'STOCKFISH', alias: ' German ', difficulty: 'medio', playerColor: 'black' }),
    { mode: 'STOCKFISH', alias: 'German', difficulty: 'MEDIO', playerColor: 'BLACK' },
  );
});

for (const [nombre, body] of [
  ['modo inexistente', { mode: 'ONLINE' }],
  ['máquina sin alias', { mode: 'AI', difficulty: 'FACIL', playerColor: 'WHITE' }],
  ['máquina sin dificultad', { mode: 'AI', alias: 'x', playerColor: 'WHITE' }],
  ['dificultad inexistente', { mode: 'AI', alias: 'x', difficulty: 'EXTREMO', playerColor: 'WHITE' }],
  ['color inválido', { mode: 'AI', alias: 'x', difficulty: 'FACIL', playerColor: 'ROJO' }],
  ['alias demasiado largo', { mode: 'AI', alias: 'x'.repeat(41), difficulty: 'FACIL', playerColor: 'WHITE' }],
]) {
  test(`nueva partida inválida: ${nombre}`, () => {
    assert.throws(() => V.validarNuevaPartida(body), ValidationError);
  });
}

test('id debe ser UUID', () => {
  assert.throws(() => V.validarId('123'), ValidationError);
  assert.equal(V.validarId('A1B2C3D4-0000-4000-8000-000000000000'), 'a1b2c3d4-0000-4000-8000-000000000000');
});

test('filtros del historial', () => {
  assert.deepEqual(V.validarFiltrosHistorial({ mode: 'ai', status: 'paused' }), {
    mode: 'AI',
    status: 'PAUSED',
    limit: 50,
    offset: 0,
  });
  assert.throws(() => V.validarFiltrosHistorial({ result: 'GANADAS' }), ValidationError);
  assert.throws(() => V.validarFiltrosHistorial({ limit: '500' }), ValidationError);
});

// ── Configuración (Fail-Fast) ──

test('sin DATABASE_URL la configuración falla', () => {
  assert.throws(() => loadConfig({}), /DATABASE_URL es obligatoria/);
});

test('configuración por defecto con DATABASE_URL', () => {
  const c = loadConfig({ DATABASE_URL: 'postgresql://x' });
  assert.equal(c.port, 3001);
  assert.equal(c.stockfishTimeoutMs, 3000);
});

test('STORE=memory no exige DATABASE_URL', () => {
  assert.equal(loadConfig({ STORE: 'memory' }).store, 'memory');
});

test('CORS: por defecto acepta Vite (5173) y Next (3000); FRONTEND_URL admite varios separados por coma', () => {
  assert.deepEqual(loadConfig({ STORE: 'memory' }).frontendUrl, ['http://localhost:5173', 'http://localhost:3000']);
  assert.deepEqual(loadConfig({ STORE: 'memory', FRONTEND_URL: 'http://a:1/, http://b:2' }).frontendUrl, ['http://a:1', 'http://b:2']);
});
