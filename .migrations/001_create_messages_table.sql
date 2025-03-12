-- Create migrations table if it doesn't exist
CREATE TABLE IF NOT EXISTS migrations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create messages table
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  publish_at DATETIME NOT NULL,
  delivered_at DATETIME,
  retry_at DATETIME,
  retried INTEGER DEFAULT 0,
  status TEXT NOT NULL,
  last_errors TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);
CREATE INDEX IF NOT EXISTS idx_messages_publish_at ON messages(publish_at); 