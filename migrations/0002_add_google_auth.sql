-- Add Google OAuth support
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS google_id TEXT UNIQUE;

-- Make password nullable for Google-only accounts (default to empty string)
ALTER TABLE users
  ALTER COLUMN password SET DEFAULT '';
