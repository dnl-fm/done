-- Create message stats table for precalculated statistics
CREATE TABLE IF NOT EXISTS message_stats (
    date TEXT NOT NULL,
    hour INTEGER NOT NULL CHECK (hour >= 0 AND hour < 24),
    status TEXT NOT NULL,
    count INTEGER DEFAULT 0,
    PRIMARY KEY (date, hour, status)
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_message_stats_date ON message_stats(date);
CREATE INDEX IF NOT EXISTS idx_message_stats_status ON message_stats(status);
CREATE INDEX IF NOT EXISTS idx_message_stats_date_hour ON message_stats(date, hour);