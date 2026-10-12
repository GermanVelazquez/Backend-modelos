'use strict';

/**
 * Enumeraciones del dominio. Son los valores que se guardan en la base y que viajan en el JSON.
 * Se unificaron en inglés para que coincidan con los valores que ya usa Diseño Técnico
 * (mode: LOCAL | STOCKFISH | AI). Ver el PDF de observaciones, punto "Estados de la partida".
 */

const GameMode = Object.freeze({
  LOCAL: 'LOCAL', // CU-02: dos personas en la misma PC
  STOCKFISH: 'STOCKFISH', // CU-03
  AI: 'AI', // CU-04: IA propia
});

const PlayerType = Object.freeze({
  HUMAN: 'HUMAN',
  STOCKFISH: 'STOCKFISH',
  AI: 'AI',
});

/** Ciclo de vida de RN-01: En Curso -> Pendiente/Pausada -> Finalizada */
const GameStatus = Object.freeze({
  IN_PROGRESS: 'IN_PROGRESS', // "En Curso"
  PAUSED: 'PAUSED', // "Pendiente / Pausada"
  FINISHED: 'FINISHED', // "Finalizada"
});

const GameResult = Object.freeze({
  WHITE_WINS: 'WHITE_WINS',
  BLACK_WINS: 'BLACK_WINS',
  DRAW: 'DRAW',
});

/** Motivos de fin de RN-03 */
const EndReason = Object.freeze({
  CHECKMATE: 'CHECKMATE',
  STALEMATE: 'STALEMATE',
  THREEFOLD_REPETITION: 'THREEFOLD_REPETITION',
  FIFTY_MOVES: 'FIFTY_MOVES',
  INSUFFICIENT_MATERIAL: 'INSUFFICIENT_MATERIAL',
  RESIGNATION: 'RESIGNATION',
});

const Difficulty = Object.freeze({
  EASY: 'FACIL',
  MEDIUM: 'MEDIO',
  HARD: 'DIFICIL',
});

const GameSource = Object.freeze({
  USER: 'USER',
  SEED: 'SEED',
});

const Color = Object.freeze({
  WHITE: 'WHITE',
  BLACK: 'BLACK',
});

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

module.exports = {
  GameMode,
  PlayerType,
  GameStatus,
  GameResult,
  EndReason,
  Difficulty,
  GameSource,
  Color,
  START_FEN,
};
