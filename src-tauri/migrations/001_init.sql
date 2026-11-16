-- Metadata only. Media lives on disk; API keys live in the OS credential store.

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE folders (
  id         INTEGER PRIMARY KEY,
  parent_id  INTEGER REFERENCES folders(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE projects (
  id         INTEGER PRIMARY KEY,
  folder_id  INTEGER REFERENCES folders(id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE assets (
  id         INTEGER PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('content','audio','thumbnail','subtitle','transcript','voice_sample')),
  title      TEXT,
  file_path  TEXT,
  body       TEXT,
  lang       TEXT,
  meta_json  TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_assets_project ON assets(project_id, kind);

-- No key/secret column by design.
CREATE TABLE providers (
  id              TEXT PRIMARY KEY,
  category        TEXT NOT NULL CHECK (category IN ('text','image','tts','clone','stt')),
  adapter         TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  endpoint        TEXT,
  enabled         INTEGER NOT NULL DEFAULT 1,
  cost_class      TEXT NOT NULL CHECK (cost_class IN ('local','free','free_tier','paid')),
  settings_json   TEXT,
  last_status     TEXT,
  last_error      TEXT,
  last_checked_at TEXT
);

CREATE TABLE provider_defaults (
  category    TEXT PRIMARY KEY,
  provider_id TEXT REFERENCES providers(id) ON DELETE SET NULL,
  model       TEXT
);

CREATE TABLE fallback_chains (
  category    TEXT NOT NULL,
  position    INTEGER NOT NULL,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  model       TEXT,
  PRIMARY KEY (category, position)
);

CREATE TABLE voice_profiles (
  id                   INTEGER PRIMARY KEY,
  name                 TEXT NOT NULL,
  engine               TEXT NOT NULL,
  sample_path          TEXT NOT NULL,
  lang                 TEXT,
  consent_confirmed_at TEXT NOT NULL,
  consent_statement    TEXT NOT NULL,
  created_at           TEXT NOT NULL
);

CREATE TABLE voice_favorites (
  provider_id TEXT NOT NULL,
  voice_id    TEXT NOT NULL,
  PRIMARY KEY (provider_id, voice_id)
);

CREATE TABLE tts_history (
  id               INTEGER PRIMARY KEY,
  provider_id      TEXT,
  voice_id         TEXT,
  voice_profile_id INTEGER REFERENCES voice_profiles(id) ON DELETE SET NULL,
  lang             TEXT,
  text_preview     TEXT,
  audio_path       TEXT,
  params_json      TEXT,
  created_at       TEXT NOT NULL
);

CREATE TABLE subtitle_tracks (
  id           INTEGER PRIMARY KEY,
  asset_id     INTEGER REFERENCES assets(id) ON DELETE CASCADE,
  lang         TEXT,
  source_media TEXT
);

CREATE TABLE subtitle_segments (
  id       INTEGER PRIMARY KEY,
  track_id INTEGER NOT NULL REFERENCES subtitle_tracks(id) ON DELETE CASCADE,
  idx      INTEGER NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms   INTEGER NOT NULL,
  text     TEXT NOT NULL
);
CREATE INDEX idx_segments_track ON subtitle_segments(track_id, idx);

CREATE TABLE prompts (
  id       INTEGER PRIMARY KEY,
  name     TEXT NOT NULL,
  category TEXT,
  template TEXT NOT NULL,
  builtin  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE generation_log (
  id          INTEGER PRIMARY KEY,
  category    TEXT,
  provider_id TEXT,
  model       TEXT,
  status      TEXT,
  error_code  TEXT,
  duration_ms INTEGER,
  created_at  TEXT NOT NULL
);

CREATE TABLE local_models (
  id           TEXT PRIMARY KEY,
  kind         TEXT,
  path         TEXT,
  size_bytes   INTEGER,
  sha256       TEXT,
  installed_at TEXT
);
