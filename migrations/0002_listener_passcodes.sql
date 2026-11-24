CREATE TABLE IF NOT EXISTS listener_passcodes (
  name_key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  account_id TEXT NOT NULL UNIQUE,
  pin_record TEXT NOT NULL
);
