'use strict';

const { Router } = require('express');
const crearGamesController = require('../controllers/gamesController');

/** Rutas según la tabla "Endpoints Propuestos" de Diseño Técnico (sin prefijo /api). */
function crearRutas({ gestor, historial, store }) {
  const router = Router();
  const games = crearGamesController({ gestor, historial });

  router.get('/health', async (req, res) => {
    try {
      await store.ping();
      res.json({ status: 'ok', database: 'up' });
    } catch {
      res.status(503).json({ status: 'degraded', database: 'down' });
    }
  });

  router.get('/difficulty-profiles', async (req, res) => {
    const perfiles = await store.profiles.findAll();
    res.json(
      perfiles.map((p) => ({
        id: p.id,
        name: p.name,
        engineType: p.engineType,
        eloMin: p.eloMin,
        eloMax: p.eloMax,
      })),
    );
  });

  router.post('/games', games.crear);
  router.get('/games', games.listar);
  router.get('/games/:id', games.obtener);
  router.get('/games/:id/pgn', games.pgn);
  router.get('/games/:id/legal-moves', games.movimientosLegales);
  router.post('/games/:id/moves', games.mover);
  router.post('/games/:id/engine-move', games.turnoMaquina);
  router.post('/games/:id/pause', games.pausar);
  router.post('/games/:id/resume', games.reanudar);
  router.post('/games/:id/resign', games.rendirse);

  return router;
}

module.exports = crearRutas;
