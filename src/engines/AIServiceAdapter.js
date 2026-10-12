'use strict';

const { EngineTimeoutError, EngineUnavailableError } = require('../errors');

/**
 * Cliente HTTP del microservicio de IA (Python/FastAPI, puerto 8000).
 * Contrato (Diseño Técnico): POST /predict-move { fen, difficulty, elo } -> { move, source }
 * Se agrega gameId al cuerpo, como pide el diagrama de clases (predictMove(fen, gameId, timeoutMs)).
 */
class AIServiceAdapter {
  constructor({ baseUrl, timeoutMs = 3000, fetchImpl = globalThis.fetch }) {
    this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl;
  }

  async predictMove(fen, { gameId, difficulty, elo } = {}, timeoutMs = this.timeoutMs) {
    let respuesta;
    try {
      respuesta = await this.fetch(`${this.baseUrl}/predict-move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fen, difficulty, elo, gameId }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) throw new EngineTimeoutError('IA propia');
      throw new EngineUnavailableError(`No se pudo contactar al servicio de IA en ${this.baseUrl}`);
    }
    if (!respuesta.ok) {
      throw new EngineUnavailableError(`El servicio de IA respondió ${respuesta.status}`);
    }
    const datos = await respuesta.json();
    return { move: datos.move ?? null, source: datos.source ?? 'none' };
  }
}

module.exports = AIServiceAdapter;
