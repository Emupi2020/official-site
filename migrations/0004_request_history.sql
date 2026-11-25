CREATE TABLE request_history (
  id TEXT PRIMARY KEY,
  account_id TEXT,
  name_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  entry TEXT NOT NULL
);
CREATE INDEX request_history_account ON request_history (account_id, created_at DESC, id DESC) WHERE account_id IS NOT NULL;
CREATE INDEX request_history_guest ON request_history (name_key, created_at DESC, id DESC) WHERE account_id IS NULL;
