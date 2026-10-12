-- 001_init.sql  ·  Modelo físico propuesto por Backend (basado en el Diagrama de Clases v. vigente)
-- Cambios respecto del diagrama (ver PDF de observaciones):
--   games:  + status, + end_reason, + white_alias, + black_alias
--   moves:  + uci, + fen_before_key (FEN simplificado de 4 campos para la IA), UNIQUE(game_id, move_number)
--   difficulty_profiles: + elo_min, + elo_max, UNIQUE(engine_type, name)
--   v_training_moves: vista que solo expone jugadas de partidas FINALIZADAS (RN-01)

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid() (nativo desde PG 13, se deja por compatibilidad)

CREATE TABLE IF NOT EXISTS difficulty_profiles (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           VARCHAR(10)  NOT NULL CHECK (name IN ('FACIL', 'MEDIO', 'DIFICIL')),
  engine_type    VARCHAR(10)  NOT NULL CHECK (engine_type IN ('STOCKFISH', 'AI')),
  skill_level    INTEGER      CHECK (skill_level BETWEEN 0 AND 20),
  search_depth   INTEGER      CHECK (search_depth > 0),
  time_limit_ms  INTEGER      NOT NULL DEFAULT 1000 CHECK (time_limit_ms > 0),
  elo_min        INTEGER,
  elo_max        INTEGER,
  UNIQUE (engine_type, name)
);

CREATE TABLE IF NOT EXISTS games (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode                   VARCHAR(10) NOT NULL CHECK (mode IN ('LOCAL', 'STOCKFISH', 'AI')),
  white_type             VARCHAR(10) NOT NULL CHECK (white_type IN ('HUMAN', 'STOCKFISH', 'AI')),
  black_type             VARCHAR(10) NOT NULL CHECK (black_type IN ('HUMAN', 'STOCKFISH', 'AI')),
  white_alias            VARCHAR(40),
  black_alias            VARCHAR(40),
  difficulty_profile_id  UUID REFERENCES difficulty_profiles(id),
  status                 VARCHAR(12) NOT NULL DEFAULT 'IN_PROGRESS'
                           CHECK (status IN ('IN_PROGRESS', 'PAUSED', 'FINISHED')),
  result                 VARCHAR(10) CHECK (result IN ('WHITE_WINS', 'BLACK_WINS', 'DRAW')),
  end_reason             VARCHAR(25) CHECK (end_reason IN ('CHECKMATE', 'STALEMATE', 'THREEFOLD_REPETITION',
                                                           'FIFTY_MOVES', 'INSUFFICIENT_MATERIAL', 'RESIGNATION')),
  current_fen            TEXT NOT NULL,
  started_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at               TIMESTAMPTZ,
  source                 VARCHAR(4) NOT NULL DEFAULT 'USER' CHECK (source IN ('USER', 'SEED')),
  -- Coherencia: una partida finalizada tiene resultado y fecha de fin; una no finalizada no.
  CHECK ((status = 'FINISHED') = (result IS NOT NULL AND ended_at IS NOT NULL)),
  -- Las partidas jugadas en el sistema guardan su motivo de fin. Las importadas de Lichess (SEED)
  -- pueden no tenerlo (p. ej. terminaron por tiempo), así que ahí se permite NULL.
  CHECK (status <> 'FINISHED' OR end_reason IS NOT NULL OR source = 'SEED'),
  -- Las partidas contra la máquina necesitan perfil de dificultad
  CHECK (mode = 'LOCAL' OR difficulty_profile_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_games_status     ON games (status);
CREATE INDEX IF NOT EXISTS idx_games_mode       ON games (mode);
CREATE INDEX IF NOT EXISTS idx_games_started_at ON games (started_at DESC);

CREATE TABLE IF NOT EXISTS moves (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id         UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  move_number     INTEGER NOT NULL CHECK (move_number >= 1),     -- número de medio movimiento (ply)
  color           VARCHAR(5) NOT NULL CHECK (color IN ('WHITE', 'BLACK')),
  san             VARCHAR(10) NOT NULL,
  uci             VARCHAR(5)  NOT NULL,                          -- "e2e4", "e7e8q" (formato del dataset de Simulación)
  fen_before      TEXT NOT NULL,
  fen_after       TEXT NOT NULL,
  -- FEN simplificado (posición, turno, enroques, al paso) para que la IA reconozca la misma posición
  -- aunque haya ocurrido en distinto número de jugada (Arquitectura 6.2).
  fen_before_key  TEXT GENERATED ALWAYS AS (
                    split_part(fen_before, ' ', 1) || ' ' || split_part(fen_before, ' ', 2) || ' ' ||
                    split_part(fen_before, ' ', 3) || ' ' || split_part(fen_before, ' ', 4)) STORED,
  eval_score      DOUBLE PRECISION,
  timestamp_ms    INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (game_id, move_number)                                  -- evita jugadas duplicadas por pedidos simultáneos
);

CREATE INDEX IF NOT EXISTS idx_moves_fen_before_key ON moves (fen_before_key);

CREATE TABLE IF NOT EXISTS ai_model_versions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trained_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  dataset_size  INTEGER,
  metrics       JSONB,
  file_path     TEXT NOT NULL
);

-- Dataset de entrenamiento: SOLO partidas finalizadas (RN-01). Corrige que hoy se entrena también
-- con partidas IN_PROGRESS. Simulación puede leer de esta vista en lugar de la tabla moves.
CREATE OR REPLACE VIEW v_training_moves AS
SELECT m.id, m.game_id, m.move_number, m.color, m.san, m.uci,
       m.fen_before, m.fen_before_key, m.fen_after,
       g.result, g.source, g.mode
FROM moves m
JOIN games g ON g.id = m.game_id
WHERE g.status = 'FINISHED';

-- Perfiles de dificultad. Skill Level de Stockfish según Arquitectura (3 / 10 / 20).
-- Rangos ELO según Requisitos (pestaña 01). Pendiente de confirmar con el profesor si se usa ELO.
INSERT INTO difficulty_profiles (name, engine_type, skill_level, search_depth, time_limit_ms, elo_min, elo_max) VALUES
  ('FACIL',   'STOCKFISH',  3, NULL, 1000,  800, 1200),
  ('MEDIO',   'STOCKFISH', 10, NULL, 1000, 1300, 1700),
  ('DIFICIL', 'STOCKFISH', 20, NULL, 1000, 1800, NULL),
  ('FACIL',   'AI',      NULL, NULL, 1000,  800, 1200),
  ('MEDIO',   'AI',      NULL, NULL, 1000, 1300, 1700),
  ('DIFICIL', 'AI',      NULL, NULL, 1000, 1800, NULL)
ON CONFLICT (engine_type, name) DO NOTHING;
