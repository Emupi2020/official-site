CREATE TABLE listener_favorites (
  account_id TEXT NOT NULL,
  favorite_key TEXT NOT NULL,
  PRIMARY KEY (account_id, favorite_key)
) WITHOUT ROWID;
