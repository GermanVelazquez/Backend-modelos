'use strict';

const { ValidationError } = require('../errors');
const { GameMode, Difficulty, Color, GameStatus, GameResult } = require('../models/constants');

const SQUARE = /^[a-h][1-8]$/;
const PROMOTION_PIECES = ['q', 'r', 'b', 'n'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ALIAS = 40;

/**
 * Valida la FORMA de los datos que entran por la API (validación de entrada).
 * La legalidad ajedrecística (jaque, enroque, etc.) la decide Tablero.
 */
class ValidadorDeJugada {
  static validarId(id) {
    if (!UUID.test(String(id))) throw new ValidationError('El id de partida no es un UUID válido', { field: 'id' });
    return String(id).toLowerCase();
  }

  static validarCasilla(valor, campo) {
    const casilla = String(valor ?? '').trim().toLowerCase();
    if (!SQUARE.test(casilla)) {
      throw new ValidationError(`${campo} debe ser una casilla entre a1 y h8`, { field: campo, value: valor });
    }
    return casilla;
  }

  /** Cuerpo de POST /games/:id/moves: { from, to, promotion? } */
  static validarJugada(body) {
    if (!body || typeof body !== 'object') throw new ValidationError('Falta el cuerpo de la jugada');
    const from = ValidadorDeJugada.validarCasilla(body.from, 'from');
    const to = ValidadorDeJugada.validarCasilla(body.to, 'to');
    if (from === to) throw new ValidationError('from y to no pueden ser la misma casilla', { field: 'to' });

    const jugada = { from, to };
    if (body.promotion !== undefined && body.promotion !== null && body.promotion !== '') {
      const promotion = String(body.promotion).trim().toLowerCase();
      if (!PROMOTION_PIECES.includes(promotion)) {
        throw new ValidationError('promotion debe ser q, r, b o n', { field: 'promotion', value: body.promotion });
      }
      jugada.promotion = promotion;
    }
    return jugada;
  }

  static validarAlias(valor, campo, { requerido }) {
    if (valor === undefined || valor === null || String(valor).trim() === '') {
      if (requerido) throw new ValidationError(`${campo} es obligatorio`, { field: campo });
      return null;
    }
    const alias = String(valor).trim();
    if (alias.length > MAX_ALIAS) {
      throw new ValidationError(`${campo} admite como máximo ${MAX_ALIAS} caracteres`, { field: campo });
    }
    return alias;
  }

  /**
   * Cuerpo de POST /games (CU-01).
   * - LOCAL: { mode, whiteAlias?, blackAlias? }  (sin dificultad ni bando)
   * - STOCKFISH / AI: { mode, alias, difficulty, playerColor }
   */
  static validarNuevaPartida(body) {
    if (!body || typeof body !== 'object') throw new ValidationError('Falta el cuerpo de la partida');
    const mode = String(body.mode ?? '').toUpperCase();
    if (!Object.values(GameMode).includes(mode)) {
      throw new ValidationError('mode debe ser LOCAL, STOCKFISH o AI', { field: 'mode', value: body.mode });
    }

    if (mode === GameMode.LOCAL) {
      return {
        mode,
        whiteAlias: ValidadorDeJugada.validarAlias(body.whiteAlias, 'whiteAlias', { requerido: false }) || 'Blancas',
        blackAlias: ValidadorDeJugada.validarAlias(body.blackAlias, 'blackAlias', { requerido: false }) || 'Negras',
      };
    }

    const alias = ValidadorDeJugada.validarAlias(body.alias, 'alias', { requerido: true });
    const difficulty = String(body.difficulty ?? '').toUpperCase();
    if (!Object.values(Difficulty).includes(difficulty)) {
      throw new ValidationError('difficulty debe ser FACIL, MEDIO o DIFICIL', { field: 'difficulty', value: body.difficulty });
    }
    const playerColor = String(body.playerColor ?? '').toUpperCase();
    if (!Object.values(Color).includes(playerColor)) {
      throw new ValidationError('playerColor debe ser WHITE o BLACK', { field: 'playerColor', value: body.playerColor });
    }
    return { mode, alias, difficulty, playerColor };
  }

  static validarColor(valor, campo = 'color') {
    const color = String(valor ?? '').toUpperCase();
    if (!Object.values(Color).includes(color)) {
      throw new ValidationError(`${campo} debe ser WHITE o BLACK`, { field: campo, value: valor });
    }
    return color;
  }

  /** Filtros de GET /games (CU-05) */
  static validarFiltrosHistorial(query = {}) {
    const filtros = {};
    const enumFiltro = (campo, valores) => {
      if (query[campo] === undefined || query[campo] === '') return;
      const valor = String(query[campo]).toUpperCase();
      if (!valores.includes(valor)) {
        throw new ValidationError(`${campo} debe ser uno de: ${valores.join(', ')}`, { field: campo, value: query[campo] });
      }
      filtros[campo] = valor;
    };
    enumFiltro('mode', Object.values(GameMode));
    enumFiltro('difficulty', Object.values(Difficulty));
    enumFiltro('status', Object.values(GameStatus));
    enumFiltro('result', Object.values(GameResult));
    if (query.alias) filtros.alias = String(query.alias).trim().slice(0, MAX_ALIAS);

    const limit = query.limit === undefined ? 50 : Number(query.limit);
    const offset = query.offset === undefined ? 0 : Number(query.offset);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new ValidationError('limit debe ser un entero entre 1 y 200', { field: 'limit' });
    }
    if (!Number.isInteger(offset) || offset < 0) {
      throw new ValidationError('offset debe ser un entero mayor o igual a 0', { field: 'offset' });
    }
    filtros.limit = limit;
    filtros.offset = offset;
    return filtros;
  }
}

module.exports = ValidadorDeJugada;
