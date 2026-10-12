'use strict';

const { AppError } = require('../errors');

/** Formato único de error: { valid?, error: { code, message, details? } } */
function notFound(req, res) {
  res.status(404).json({ error: { code: 'ROUTE_NOT_FOUND', message: `No existe ${req.method} ${req.path}` } });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // JSON mal formado en el cuerpo
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'El cuerpo no es un JSON válido' } });
  }
  if (err instanceof AppError) {
    const body = { error: { code: err.code, message: err.message } };
    if (err.details !== undefined) body.error.details = err.details;
    // CU-06 2a: la respuesta de una jugada rechazada mantiene la forma ResultadoJugada { valid: false }
    if (['ILLEGAL_MOVE', 'PROMOTION_REQUIRED'].includes(err.code)) body.valid = false;
    return res.status(err.status).json(body);
  }
  console.error(err);
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Error interno del servidor' } });
}

module.exports = { notFound, errorHandler };
