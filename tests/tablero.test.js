'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Tablero = require('../src/validators/Tablero');
const { IllegalMoveError, PromotionRequiredError } = require('../src/errors');

/** Aplica una lista de jugadas "e2e4" y devuelve el tablero */
function jugar(...ucis) {
  const t = new Tablero();
  for (const u of ucis) t.aplicarJugada(Tablero.parsearUci(u));
  return t;
}

test('jugada legal: devuelve SAN, UCI y FEN antes/después', () => {
  const t = new Tablero();
  const r = t.aplicarJugada({ from: 'e2', to: 'e4' });
  assert.equal(r.san, 'e4');
  assert.equal(r.uci, 'e2e4');
  assert.equal(r.color, 'WHITE');
  assert.match(r.fenBefore, /^rnbqkbnr\/pppppppp\/8\/8\/8\/8\/PPPPPPPP\/RNBQKBNR w/);
  assert.match(r.fenAfter, / b KQkq - 0 1$/);
  assert.equal(t.turno(), 'BLACK');
});

test('jugada ilegal: lanza IllegalMoveError y no cambia el tablero (CU-06 2a)', () => {
  const t = new Tablero();
  const fen = t.fen();
  assert.throws(() => t.aplicarJugada({ from: 'e2', to: 'e5' }), IllegalMoveError);
  assert.equal(t.fen(), fen);
});

test('no se puede mover una pieza clavada que deja al rey en jaque (RN-02 Bis)', () => {
  // Alfil blanco en e2 clavado por la dama negra en e8 contra el rey en e1
  const t = new Tablero('4q2k/8/8/8/8/8/4B3/4K3 w - - 0 1');
  assert.throws(() => t.aplicarJugada({ from: 'e2', to: 'd3' }), IllegalMoveError);
});

test('enroque corto legal y prohibido si el rey pasa por casilla atacada', () => {
  const ok = new Tablero('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  assert.equal(ok.aplicarJugada({ from: 'e1', to: 'g1' }).san, 'O-O');

  // Torre negra en f8 ataca f1: el rey no puede pasar por f1
  const atacado = new Tablero('5r1k/8/8/8/8/8/8/4K2R w K - 0 1');
  assert.throws(() => atacado.aplicarJugada({ from: 'e1', to: 'g1' }), IllegalMoveError);
});

test('captura al paso solo en el turno inmediato', () => {
  const t = jugar('e2e4', 'a7a6', 'e4e5', 'd7d5');
  assert.equal(t.aplicarJugada({ from: 'e5', to: 'd6' }).san, 'exd6');

  const tarde = jugar('e2e4', 'a7a6', 'e4e5', 'd7d5', 'h2h3', 'h7h6');
  assert.throws(() => tarde.aplicarJugada({ from: 'e5', to: 'd6' }), IllegalMoveError);
});

test('promoción: exige elegir pieza y permite coronar caballo', () => {
  const fen = '8/P6k/8/8/8/8/8/K7 w - - 0 1';
  assert.throws(() => new Tablero(fen).aplicarJugada({ from: 'a7', to: 'a8' }), PromotionRequiredError);
  const r = new Tablero(fen).aplicarJugada({ from: 'a7', to: 'a8', promotion: 'n' });
  assert.equal(r.san, 'a8=N');
  assert.equal(r.uci, 'a7a8n');
});

test('promotion se ignora si la jugada no es una coronación', () => {
  const r = new Tablero().aplicarJugada({ from: 'e2', to: 'e4', promotion: 'q' });
  assert.equal(r.san, 'e4');
});

test('jaque mate: mate del pastor da victoria a blancas', () => {
  const t = jugar('e2e4', 'e7e5', 'd1h5', 'b8c6', 'f1c4', 'g8f6', 'h5f7');
  assert.deepEqual(t.evaluarFin(), { result: 'WHITE_WINS', endReason: 'CHECKMATE' });
});

test('jaque mate: mate del loco da victoria a negras', () => {
  const t = jugar('f2f3', 'e7e5', 'g2g4', 'd8h4');
  assert.deepEqual(t.evaluarFin(), { result: 'BLACK_WINS', endReason: 'CHECKMATE' });
});

test('ahogado = tablas', () => {
  const t = new Tablero('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  assert.deepEqual(t.evaluarFin(), { result: 'DRAW', endReason: 'STALEMATE' });
});

test('material insuficiente: rey y alfil contra rey = tablas', () => {
  const t = new Tablero('8/8/8/4k3/8/8/2B5/4K3 w - - 0 1');
  assert.deepEqual(t.evaluarFin(), { result: 'DRAW', endReason: 'INSUFFICIENT_MATERIAL' });
});

test('triple repetición se detecta al reconstruir desde las jugadas guardadas', () => {
  const ida = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
  const jugadas = [...ida, ...ida].map((uci) => ({ uci }));
  const t = Tablero.desdeJugadas(jugadas);
  assert.deepEqual(t.evaluarFin(), { result: 'DRAW', endReason: 'THREEFOLD_REPETITION' });

  // Con el FEN solo (sin historial) NO se puede detectar: por eso se reconstruye.
  assert.equal(new Tablero(t.fen()).evaluarFin(), null);
});

test('regla de los 50 movimientos', () => {
  const t = new Tablero('8/8/8/4k3/8/8/4R3/4K3 w - - 99 80');
  t.aplicarJugada({ from: 'e2', to: 'a2' });
  assert.deepEqual(t.evaluarFin(), { result: 'DRAW', endReason: 'FIFTY_MOVES' });
});

test('movimientos legales de una casilla (resaltado de destinos)', () => {
  const destinos = new Tablero().obtenerMovimientosLegales('g1').map((m) => m.to).sort();
  assert.deepEqual(destinos, ['f3', 'h3']);
  assert.deepEqual(new Tablero().obtenerMovimientosLegales('e4'), []);
});

test('parsearUci', () => {
  assert.deepEqual(Tablero.parsearUci('e7e8q'), { from: 'e7', to: 'e8', promotion: 'q' });
  assert.deepEqual(Tablero.parsearUci('E2E4'), { from: 'e2', to: 'e4' });
  assert.equal(Tablero.parsearUci('(none)'), null);
  assert.equal(Tablero.parsearUci(undefined), null);
});
