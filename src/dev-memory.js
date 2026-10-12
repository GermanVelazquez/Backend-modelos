'use strict';

/**
 * Levanta el backend SIN base de datos (todo en memoria). Funciona igual en Windows, Linux y macOS.
 * Uso: pnpm dev:memory
 * Las partidas se pierden al cortar el servidor: solo sirve para probar rápido.
 */
process.env.STORE = 'memory';
require('./server');
