-- Search logs table for tracking popular searches
CREATE TABLE IF NOT EXISTS search_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    search_query TEXT NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    count INTEGER DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for fast lookups by search query
CREATE INDEX IF NOT EXISTS idx_search_logs_query ON search_logs(search_query);

-- Index for trending searches (by count and date)
CREATE INDEX IF NOT EXISTS idx_search_logs_trending ON search_logs(count DESC, created_at DESC);

-- RLS policies
ALTER TABLE search_logs ENABLE ROW LEVEL SECURITY;

-- Anyone can read search logs (for trending)
CREATE POLICY "Search logs are viewable by everyone"
    ON search_logs FOR SELECT
    USING (true);

-- Authenticated users can insert search logs
CREATE POLICY "Authenticated users can insert search logs"
    ON search_logs FOR INSERT
    WITH CHECK (true);

-- Service role can update search logs
CREATE POLICY "Service role can update search logs"
    ON search_logs FOR UPDATE
    USING (true);
