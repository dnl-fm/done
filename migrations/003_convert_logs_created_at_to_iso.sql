-- Convert logs.created_at from Unix timestamp to ISO 8601 string
-- SQLite doesn't support ALTER COLUMN, so we need to recreate the table

-- Create new table with correct schema
CREATE TABLE logs_new (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    object TEXT NOT NULL,
    message_id TEXT NOT NULL,
    before_data TEXT NOT NULL, -- JSON string of before state
    after_data TEXT NOT NULL,  -- JSON string of after state
    created_at TEXT NOT NULL,   -- Changed from INTEGER to TEXT for ISO timestamps
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

-- Copy data from old table, converting Unix timestamps to ISO format
INSERT INTO logs_new (id, type, object, message_id, before_data, after_data, created_at)
SELECT 
    id, 
    type, 
    object, 
    message_id, 
    before_data, 
    after_data,
    datetime(created_at/1000, 'unixepoch') || 'Z' as created_at
FROM logs;

-- Drop old table
DROP TABLE logs;

-- Rename new table
ALTER TABLE logs_new RENAME TO logs;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_logs_message_id ON logs(message_id);
CREATE INDEX IF NOT EXISTS idx_logs_type ON logs(type);
CREATE INDEX IF NOT EXISTS idx_logs_created_at ON logs(created_at);