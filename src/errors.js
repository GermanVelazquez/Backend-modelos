'use strict';

/**
 * Errores de la aplicación. Cada uno lleva su código HTTP y un código estable (`code`)
 * que el frontend puede usar para decidir qué mostrar.
 */
class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

class ValidationError extends AppError {
  constructor(message, details) {
    super(400, 'VALIDATION_ERROR', message, details);
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Recurso no encontrado') {
    super(404, 'NOT_FOUND', message);
  }
}

/** CU-06 flujo 2a: jugada ilegal o que deja al propio rey en jaque */
class IllegalMoveError extends AppError {
  constructor(message = 'Jugada ilegal') {
    super(422, 'ILLEGAL_MOVE', message);
  }
}

/** CU-06: un peón llega a la última fila y no se indicó la pieza de coronación */
class PromotionRequiredError extends AppError {
  constructor() {
    super(422, 'PROMOTION_REQUIRED', 'El peón llega a la última fila: indicá promotion (q, r, b o n)');
  }
}

/** La operación no corresponde al estado actual de la partida (p. ej. mover en una partida finalizada) */
class InvalidStateError extends AppError {
  constructor(message) {
    super(409, 'INVALID_STATE', message);
  }
}

/** No es el turno de quien intenta mover */
class NotYourTurnError extends AppError {
  constructor(message) {
    super(409, 'NOT_YOUR_TURN', message);
  }
}

/** Dos pedidos intentaron guardar la misma jugada a la vez */
class ConcurrentMoveError extends AppError {
  constructor() {
    super(409, 'CONCURRENT_MOVE', 'La partida cambió mientras se procesaba la jugada; recargala y reintentá');
  }
}

/** CU-03 flujo 3a: el motor no respondió a tiempo. El turno queda intacto y se puede reintentar. */
class EngineTimeoutError extends AppError {
  constructor(engine) {
    super(504, 'ENGINE_TIMEOUT', `El motor ${engine} no respondió a tiempo. Podés reintentar o pausar la partida.`, {
      retryable: true,
    });
  }
}

class EngineUnavailableError extends AppError {
  constructor(message) {
    super(503, 'ENGINE_UNAVAILABLE', message, { retryable: true });
  }
}

/** El motor devolvió una jugada que no es legal en la posición */
class EngineBadMoveError extends AppError {
  constructor(engine, move) {
    super(502, 'ENGINE_BAD_MOVE', `El motor ${engine} devolvió una jugada inválida: ${move}`, { retryable: true });
  }
}

module.exports = {
  AppError,
  ValidationError,
  NotFoundError,
  IllegalMoveError,
  PromotionRequiredError,
  InvalidStateError,
  NotYourTurnError,
  ConcurrentMoveError,
  EngineTimeoutError,
  EngineUnavailableError,
  EngineBadMoveError,
};
