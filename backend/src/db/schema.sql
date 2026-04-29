CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS therapists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS patients (
  id TEXT PRIMARY KEY,
  therapist_id UUID REFERENCES therapists(id) ON DELETE SET NULL,
  display_name TEXT NOT NULL,
  date_of_birth DATE,
  dominant_hand TEXT CHECK (dominant_hand IN ('left', 'right', 'unknown')) DEFAULT 'unknown',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gloves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id TEXT REFERENCES patients(id) ON DELETE SET NULL,
  device_name TEXT NOT NULL,
  serial_number TEXT UNIQUE,
  firmware_version TEXT,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS exercises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  target_gesture TEXT,
  difficulty INTEGER NOT NULL DEFAULT 1 CHECK (difficulty BETWEEN 1 AND 10),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  therapist_id UUID REFERENCES therapists(id) ON DELETE SET NULL,
  glove_id UUID REFERENCES gloves(id) ON DELETE SET NULL,
  exercise_id UUID REFERENCES exercises(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'ended')) DEFAULT 'active',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gesture_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  glove_id UUID REFERENCES gloves(id) ON DELETE SET NULL,
  gesture TEXT NOT NULL CHECK (gesture IN ('open', 'fist', 'pinch', 'point', 'unknown')),
  thumb INTEGER NOT NULL CHECK (thumb BETWEEN 0 AND 100),
  index_finger INTEGER NOT NULL CHECK (index_finger BETWEEN 0 AND 100),
  middle INTEGER NOT NULL CHECK (middle BETWEEN 0 AND 100),
  ring INTEGER NOT NULL CHECK (ring BETWEEN 0 AND 100),
  pinky INTEGER NOT NULL CHECK (pinky BETWEEN 0 AND 100),
  accuracy NUMERIC(5,2),
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  recorded_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS exercise_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  exercise_id UUID REFERENCES exercises(id) ON DELETE SET NULL,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  reps_completed INTEGER NOT NULL DEFAULT 0,
  successful_reps INTEGER NOT NULL DEFAULT 0,
  best_accuracy NUMERIC(5,2),
  average_accuracy NUMERIC(5,2),
  hold_time_ms INTEGER,
  smoothness NUMERIC(5,2),
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS gesture_events_patient_recorded_idx ON gesture_events(patient_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS gesture_events_session_recorded_idx ON gesture_events(session_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS sessions_patient_started_idx ON sessions(patient_id, started_at DESC);
CREATE INDEX IF NOT EXISTS sessions_active_patient_idx ON sessions(patient_id) WHERE status = 'active';

ALTER TABLE therapists ADD COLUMN IF NOT EXISTS auth_user_id UUID UNIQUE;
