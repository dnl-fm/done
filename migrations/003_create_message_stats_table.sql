-- Create message_stats table for efficient counter-based statistics
CREATE TABLE IF NOT EXISTS message_stats (
  date DATE NOT NULL,
  hour INTEGER NOT NULL DEFAULT 0 CHECK (hour >= 0 AND hour <= 23),
  status VARCHAR(20) NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (date, hour, status)
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_message_stats_date ON message_stats(date);
CREATE INDEX IF NOT EXISTS idx_message_stats_status ON message_stats(status);
CREATE INDEX IF NOT EXISTS idx_message_stats_date_status ON message_stats(date, status);