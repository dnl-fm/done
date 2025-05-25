CREATE TABLE IF NOT EXISTS logs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    object TEXT NOT NULL,
    message_id TEXT NOT NULL,
    before_data TEXT NOT NULL, -- JSON string of before state
    after_data TEXT NOT NULL,  -- JSON string of after state
    created_at INTEGER NOT NULL,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

-- Index for efficient lookups by message_id
CREATE INDEX IF NOT EXISTS idx_logs_message_id ON logs(message_id);

-- Index for efficient lookups by type
CREATE INDEX IF NOT EXISTS idx_logs_type ON logs(type);

-- Index for efficient lookups by created_at
CREATE INDEX IF NOT EXISTS idx_logs_created_at ON logs(created_at);