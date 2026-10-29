CREATE TABLE IF NOT EXISTS envelopes (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  kdf TEXT NOT NULL,
  wraps TEXT NOT NULL,
  cipher TEXT NOT NULL,
  owner_token_hash TEXT NOT NULL,
  burned_at TEXT
);
CREATE TABLE IF NOT EXISTS blobs (
  id TEXT PRIMARY KEY,
  envelope_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('signature', 'event')),
  created_at TEXT NOT NULL,
  cipher TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS blobs_env ON blobs (envelope_id, kind, created_at);
CREATE TABLE IF NOT EXISTS keys (
  id TEXT PRIMARY KEY,
  pkcs8 TEXT NOT NULL,
  pub TEXT NOT NULL,
  created_at TEXT NOT NULL
);
