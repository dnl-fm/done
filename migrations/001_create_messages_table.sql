DROP TABLE IF EXISTS messages;

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  publish_at TEXT NOT NULL,
  delivered_at TEXT,
  retry_at TEXT,
  retried INTEGER DEFAULT 0,
  status TEXT NOT NULL,
  last_errors TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);
CREATE INDEX IF NOT EXISTS idx_messages_publish_at ON messages(publish_at); 