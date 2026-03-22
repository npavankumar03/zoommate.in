-- Add practice mode support

-- meetings: track whether a session is a practice free-trial session
ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS is_practice BOOLEAN NOT NULL DEFAULT FALSE;

-- users: track the 30-min rolling window for practice free minutes
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS practice_window_start TIMESTAMP,
  ADD COLUMN IF NOT EXISTS practice_minutes_used INTEGER NOT NULL DEFAULT 0;
