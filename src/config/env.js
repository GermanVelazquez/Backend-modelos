'use strict';

/**
 * Lectura y validación de variables de entorno (Fail-Fast, Arquitectura).
 * Si falta una variable obligatoria, el servidor no arranca.
 */
function loadConfig(env = process.env) {
  const store = (env.STORE || 'postgres').toLowerCase();
  const errores = [];
  if (store === 'postgres' && !env.DATABASE_URL) errores.push('DATABASE_URL es obligatoria');
  if (!['postgres', 'memory'].includes(store)) errores.push('STORE debe ser "postgres" o "memory"');

  const numero = (nombre, porDefecto) => {
    if (env[nombre] === undefined || env[nombre] === '') return porDefecto;
    const n = Number(env[nombre]);
    if (!Number.isInteger(n) || n <= 0) errores.push(`${nombre} debe ser un entero positivo`);
    return n;
  };

  const config = {
    store,
    databaseUrl: env.DATABASE_URL,
    port: numero('PORT', 3001),
    nodeEnv: env.NODE_ENV || 'development',
    // Orígenes que pueden llamar a la API desde el navegador (CORS), separados por coma.
    // Por defecto: Vite (5173, el frontend actual) y Next.js (3000, el que nombra Arquitectura).
    frontendUrl: (env.FRONTEND_URL || 'http://localhost:5173,http://localhost:3000')
      .split(',')
      .map((s) => s.trim().replace(/\/+$/, ''))
      .filter(Boolean),
    aiServiceUrl: env.AI_SERVICE_URL || 'http://127.0.0.1:8000',
    aiTimeoutMs: numero('AI_TIMEOUT_MS', 3000),
    stockfishPath: env.STOCKFISH_PATH || './bin/stockfish',
    stockfishTimeoutMs: numero('STOCKFISH_TIMEOUT_MS', 3000),
  };

  if (errores.length) {
    const err = new Error(`Configuración inválida:\n - ${errores.join('\n - ')}`);
    err.errores = errores;
    throw err;
  }
  return config;
}

module.exports = { loadConfig };
