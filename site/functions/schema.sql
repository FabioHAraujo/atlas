-- D1 schema for the waitlist (database: atlas-waitlist, binding: DB).
-- Apply:  wrangler d1 execute atlas-waitlist --remote --file site/functions/schema.sql
CREATE TABLE IF NOT EXISTS waitlist (
  email      TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  lang       TEXT,
  topics     TEXT NOT NULL DEFAULT ''   -- comma-separated: windows, linux, macos-intel, mobile-link ('' = release notes only)
);
-- Existing databases (the CREATE above is a no-op there):
--   wrangler d1 execute atlas-waitlist --remote --command "ALTER TABLE waitlist ADD COLUMN topics TEXT NOT NULL DEFAULT ''"


-- Fixed-window rate limit keyed by a salted hash of the client IP (no raw IPs stored).
CREATE TABLE IF NOT EXISTS rate_limit (
  bucket       TEXT PRIMARY KEY,
  count        INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);
