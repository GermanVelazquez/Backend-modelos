'use strict';

const express = require('express');
const cors = require('cors');
const crearRutas = require('./routes');
const { notFound, errorHandler } = require('./middlewares/errorHandler');
const GestorDePartida = require('./services/GestorDePartida');
const ServicioHistorial = require('./services/ServicioHistorial');
const GameSessionFactory = require('./engines/GameSessionFactory');

/**
 * Arma la aplicación Express con sus dependencias inyectadas.
 * Las pruebas pasan un InMemoryStore y adaptadores falsos; server.js pasa los reales.
 */
function createApp({
  store,
  stockfishAdapter,
  aiServiceAdapter,
  frontendUrl = ['http://localhost:5173', 'http://localhost:3000'],
}) {
  const sessionFactory = new GameSessionFactory({ stockfishAdapter, aiServiceAdapter });
  const gestor = new GestorDePartida({ store, sessionFactory });
  const historial = new ServicioHistorial({ store });

  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: frontendUrl }));
  app.use(express.json({ limit: '100kb' }));
  app.use(crearRutas({ gestor, historial, store }));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = createApp;
