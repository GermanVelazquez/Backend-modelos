'use strict';

/** Convierte filas snake_case de PostgreSQL a objetos camelCase del dominio. */

function toGame(row) {
  if (!row) return null;
  return {
    id: row.id,
    mode: row.mode,
    whiteType: row.white_type,
    blackType: row.black_type,
    whiteAlias: row.white_alias,
    blackAlias: row.black_alias,
    difficultyProfileId: row.difficulty_profile_id,
    difficulty: row.difficulty ?? null,
    status: row.status,
    result: row.result,
    endReason: row.end_reason,
    currentFen: row.current_fen,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    source: row.source,
    ...(row.total_moves !== undefined ? { totalMoves: Number(row.total_moves) } : {}),
  };
}

function toMove(row) {
  if (!row) return null;
  return {
    id: row.id,
    gameId: row.game_id,
    moveNumber: row.move_number,
    color: row.color,
    san: row.san,
    uci: row.uci,
    fenBefore: row.fen_before,
    fenAfter: row.fen_after,
    evalScore: row.eval_score,
    timestampMs: row.timestamp_ms,
    createdAt: row.created_at,
  };
}

function toProfile(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    engineType: row.engine_type,
    skillLevel: row.skill_level,
    searchDepth: row.search_depth,
    timeLimitMs: row.time_limit_ms,
    eloMin: row.elo_min,
    eloMax: row.elo_max,
  };
}

module.exports = { toGame, toMove, toProfile };
