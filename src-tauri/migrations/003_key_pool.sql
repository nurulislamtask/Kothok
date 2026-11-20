-- Several API keys (for example from different free accounts) can serve one provider. When one
-- key hits its limit the app moves to the next and remembers when to try the first one again.
-- The keys themselves live in the OS credential store, never here.
CREATE TABLE key_pool (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id       TEXT    NOT NULL,
  label          TEXT    NOT NULL,
  is_primary     INTEGER NOT NULL DEFAULT 0,
  cooldown_until TEXT,
  last_error     TEXT,
  uses           INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT    NOT NULL
);
CREATE UNIQUE INDEX key_pool_primary ON key_pool(owner_id) WHERE is_primary = 1;
CREATE INDEX key_pool_owner ON key_pool(owner_id);
