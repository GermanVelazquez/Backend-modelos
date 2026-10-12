'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');
const Tablero = require('../validators/Tablero');
const { EngineTimeoutError, EngineUnavailableError } = require('../errors');

const BACKEND_ROOT = path.resolve(__dirname, '..', '..');
/** Tiempo máximo para que el motor arranque y responda "uciok" / "readyok". */
const STARTUP_TIMEOUT_MS = 15000;
/** Margen que se deja entre el tiempo de búsqueda pedido y el timeout defensivo. */
const SAFETY_MARGIN_MS = 500;

/**
 * Adaptador de Stockfish (Arquitectura 6.1, CU-03). Patrón Adapter.
 *
 * Abre el binario de Stockfish como proceso hijo (child_process.spawn) y se comunica SOLO por
 * stdin/stdout con el protocolo UCI. No hay HTTP ni sockets.
 *
 *   uci                                  -> espera "uciok"          (una vez, al arrancar)
 *   setoption name Skill Level value X   -> nivel 0..20 según el perfil (Fácil 3, Medio 10, Difícil 20)
 *   isready                              -> espera "readyok"
 *   position fen <FEN>
 *   go movetime <ms> [depth <n>]         -> espera "bestmove <jugada>"
 *
 * - Un solo proceso, compartido por todas las partidas y reutilizado entre jugadas (arrancarlo cuesta).
 * - Los pedidos se atienden de a uno (cola): UCI no admite dos búsquedas a la vez.
 * - Timeout defensivo (STOCKFISH_TIMEOUT_MS, 3000 ms): si el motor no contesta a tiempo se lanza
 *   EngineTimeoutError, el turno queda intacto y el frontend puede reintentar (CU-03 flujo 3a).
 *   El proceso colgado se mata y se vuelve a abrir en el próximo pedido.
 * - Si el binario no existe o se cae: EngineUnavailableError.
 *
 * STOCKFISH_PATH puede ser el .exe/binario o, para pruebas, un archivo .js (se ejecuta con Node).
 * Una ruta relativa se toma desde la carpeta backend/.
 */
class StockfishAdapter {
  constructor({ binaryPath, timeoutMs = 3000, startupTimeoutMs = STARTUP_TIMEOUT_MS } = {}) {
    this.binaryPath = binaryPath ? path.resolve(BACKEND_ROOT, binaryPath) : null;
    this.timeoutMs = timeoutMs;
    this.startupTimeoutMs = startupTimeoutMs;
    this.proc = null;
    this.ready = null; // Promise del arranque (uci/uciok)
    this.buffer = '';
    this.waiter = null; // { match: (linea) => boolean, resolve, reject }
    this.queue = Promise.resolve();
  }

  /**
   * @param {string} fen posición actual
   * @param {{skillLevel?: number, searchDepth?: number|null, timeLimitMs?: number}} options
   * @returns {Promise<string>} jugada en UCI ("e2e4", "e7e8q")
   */
  getBestMove(fen, options = {}) {
    const tarea = this.queue.then(() => this.#buscar(fen, options));
    // La cola sigue aunque un pedido falle.
    this.queue = tarea.catch(() => {});
    return tarea;
  }

  /** "e7e8q" -> { from, to, promotion } (helper del diagrama de clases) */
  parseUciMove(uciMove) {
    return Tablero.parsearUci(uciMove);
  }

  /** Cierra el proceso hijo. Lo llama el servidor al apagarse, no cada partida. */
  async dispose() {
    const proc = this.proc;
    this.#reset(new EngineUnavailableError('Stockfish se cerró'));
    if (!proc) return;
    try {
      proc.stdin.write('quit\n');
    } catch {
      /* ya cerrado */
    }
    const salio = new Promise((resolve) => proc.once('exit', resolve));
    const timer = setTimeout(() => proc.kill(), 1000);
    await salio;
    clearTimeout(timer);
  }

  // ───────────────────────── Internos ─────────────────────────

  async #buscar(fen, { skillLevel = 20, searchDepth = null, timeLimitMs = 1000 } = {}) {
    await this.#arrancar();

    const skill = Math.max(0, Math.min(20, Math.round(Number(skillLevel) || 0)));
    this.#enviar(`setoption name Skill Level value ${skill}`);
    await this.#esperar((l) => l === 'readyok', this.startupTimeoutMs, () => this.#enviar('isready'));

    // El tiempo de búsqueda nunca puede comerse el timeout defensivo.
    const movetime = Math.max(50, Math.min(Number(timeLimitMs) || 1000, this.timeoutMs - SAFETY_MARGIN_MS));
    this.#enviar(`position fen ${fen}`);
    const go = searchDepth ? `go depth ${searchDepth} movetime ${movetime}` : `go movetime ${movetime}`;

    let linea;
    try {
      linea = await this.#esperar((l) => l.startsWith('bestmove'), this.timeoutMs, () => this.#enviar(go));
    } catch (err) {
      if (err instanceof EngineTimeoutError) this.#matar(err);
      throw err;
    }
    const jugada = linea.split(/\s+/)[1];
    if (!jugada || jugada === '(none)') {
      throw new EngineUnavailableError('Stockfish no encontró jugadas en esta posición');
    }
    return jugada;
  }

  #arrancar() {
    if (this.ready) return this.ready;
    if (!this.binaryPath) {
      return Promise.reject(new EngineUnavailableError('STOCKFISH_PATH no está configurado'));
    }

    const esJs = /\.[cm]?js$/i.test(this.binaryPath);
    const comando = esJs ? process.execPath : this.binaryPath;
    const args = esJs ? [this.binaryPath] : [];

    this.ready = new Promise((resolve, reject) => {
      let proc;
      try {
        proc = spawn(comando, args, { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
      } catch (err) {
        reject(this.#noDisponible(err));
        return;
      }
      this.proc = proc;
      this.buffer = '';
      proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', (chunk) => this.#recibir(chunk));
      proc.stdin.on('error', () => {}); // escribir en un proceso que murió no debe tirar el servidor
      proc.once('error', (err) => {
        const error = this.#noDisponible(err);
        if (this.proc === proc) this.#reset(error);
        reject(error);
      });
      proc.once('exit', (code) => {
        if (this.proc === proc) this.#reset(new EngineUnavailableError(`Stockfish terminó inesperadamente (código ${code})`));
      });

      this.#esperar((l) => l === 'uciok', this.startupTimeoutMs, () => this.#enviar('uci'))
        .then(resolve)
        .catch((err) => {
          this.#matar(err);
          reject(err instanceof EngineTimeoutError ? new EngineUnavailableError('Stockfish no respondió al iniciar') : err);
        });
    });
    // Si el arranque falla, el próximo pedido vuelve a intentar.
    this.ready.catch(() => {
      this.ready = null;
    });
    return this.ready;
  }

  #enviar(comando) {
    if (this.proc && this.proc.stdin.writable) this.proc.stdin.write(`${comando}\n`);
  }

  #recibir(chunk) {
    this.buffer += chunk;
    let i;
    while ((i = this.buffer.indexOf('\n')) >= 0) {
      const linea = this.buffer.slice(0, i).replace(/\r$/, '').trim();
      this.buffer = this.buffer.slice(i + 1);
      if (this.waiter && this.waiter.match(linea)) {
        const { resolve } = this.waiter;
        this.waiter = null;
        resolve(linea);
      }
    }
  }

  /** Espera una línea que cumpla `match`. `disparar` envía el comando una vez registrada la espera. */
  #esperar(match, timeoutMs, disparar) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.waiter && this.waiter.resolve === done) this.waiter = null;
        reject(new EngineTimeoutError('Stockfish'));
      }, timeoutMs);
      const done = (linea) => {
        clearTimeout(timer);
        resolve(linea);
      };
      this.waiter = {
        match,
        resolve: done,
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      };
      disparar();
    });
  }

  #matar(motivo) {
    const proc = this.proc;
    this.#reset(motivo);
    if (proc) proc.kill();
  }

  #reset(motivo) {
    if (this.waiter) {
      const { reject } = this.waiter;
      this.waiter = null;
      reject(motivo);
    }
    this.proc = null;
    this.ready = null;
    this.buffer = '';
  }

  #noDisponible(err) {
    if (err && err.code === 'ENOENT') {
      return new EngineUnavailableError(`No se encontró Stockfish en ${this.binaryPath}. Revisá STOCKFISH_PATH en el .env`);
    }
    if (err && err.code === 'EACCES') {
      return new EngineUnavailableError(`No hay permiso para ejecutar Stockfish en ${this.binaryPath}`);
    }
    return new EngineUnavailableError(`No se pudo iniciar Stockfish: ${err && err.message}`);
  }
}

module.exports = StockfishAdapter;
