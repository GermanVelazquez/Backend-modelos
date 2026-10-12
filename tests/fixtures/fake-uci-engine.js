'use strict';

/**
 * Motor UCI falso para probar StockfishAdapter sin el binario real.
 * Comportamiento según la variable de entorno FAKE_UCI_MODE:
 *   ok      (por defecto) responde bestmove con la primera jugada legal
 *   slow    nunca responde a "go" (para probar el timeout)
 *   crash   se cierra al recibir "go"
 *   mute    no responde a "uci" (motor que no arranca)
 * Anota cada comando recibido en el archivo FAKE_UCI_LOG, si está definido.
 */
const fs = require('node:fs');
const readline = require('node:readline');
const { Chess } = require('chess.js');

const mode = process.env.FAKE_UCI_MODE || 'ok';
const log = process.env.FAKE_UCI_LOG;
let fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const out = (s) => process.stdout.write(`${s}\n`);

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  if (log) fs.appendFileSync(log, `${line}\n`);
  if (line === 'uci') {
    if (mode === 'mute') return;
    out('id name FakeFish');
    out('uciok');
  } else if (line === 'isready') {
    out('readyok');
  } else if (line.startsWith('position fen ')) {
    fen = line.slice('position fen '.length);
  } else if (line.startsWith('go')) {
    if (mode === 'slow') return;
    if (mode === 'crash') process.exit(3);
    const moves = new Chess(fen).moves({ verbose: true });
    out('info depth 1 score cp 0');
    out(`bestmove ${moves.length ? moves[0].lan : '(none)'}`);
  } else if (line === 'quit') {
    process.exit(0);
  }
});
