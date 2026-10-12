'use strict';

const V = require('../validators/ValidadorDeJugada');

/** Controladores: solo traducen HTTP <-> servicios. Toda la lógica está en GestorDePartida y ServicioHistorial. */
function crearGamesController({ gestor, historial }) {
  return {
    // POST /games  (CU-01)
    async crear(req, res) {
      const config = V.validarNuevaPartida(req.body);
      res.status(201).json(await gestor.crearPartida(config));
    },

    // GET /games  (CU-05)
    async listar(req, res) {
      const filtros = V.validarFiltrosHistorial(req.query);
      res.json(await historial.listarPartidas(filtros));
    },

    // GET /games/:id  (CU-05): detalle + jugadas + estado actual (turno, jaque, turno de máquina)
    async obtener(req, res) {
      const id = V.validarId(req.params.id);
      const detalle = await historial.obtenerPartida(id);
      const estado = await gestor.obtenerEstado(id);
      res.json({ ...estado, moves: detalle.moves });
    },

    // GET /games/:id/pgn  (CU-05, exportar)
    async pgn(req, res) {
      const id = V.validarId(req.params.id);
      const pgn = await historial.obtenerPGN(id);
      res.type('application/x-chess-pgn').set('Content-Disposition', `attachment; filename="partida-${id}.pgn"`);
      res.send(pgn);
    },

    // GET /games/:id/legal-moves?square=e2  (CU-06 paso 1)
    async movimientosLegales(req, res) {
      const id = V.validarId(req.params.id);
      const casilla = V.validarCasilla(req.query.square, 'square');
      res.json(await gestor.obtenerMovimientosLegales(id, casilla));
    },

    // POST /games/:id/moves  (CU-06)
    async mover(req, res) {
      const id = V.validarId(req.params.id);
      const jugada = V.validarJugada(req.body);
      res.json(await gestor.realizarJugada(id, jugada));
    },

    // POST /games/:id/engine-move  (CU-03, CU-04)
    async turnoMaquina(req, res) {
      res.json(await gestor.jugarTurnoMaquina(V.validarId(req.params.id)));
    },

    async pausar(req, res) {
      res.json(await gestor.pausarPartida(V.validarId(req.params.id)));
    },

    async reanudar(req, res) {
      res.json(await gestor.reanudarPartida(V.validarId(req.params.id)));
    },

    // POST /games/:id/resign  { color }
    async rendirse(req, res) {
      const id = V.validarId(req.params.id);
      const color = V.validarColor(req.body && req.body.color);
      res.json(await gestor.rendirse(id, color));
    },
  };
}

module.exports = crearGamesController;
