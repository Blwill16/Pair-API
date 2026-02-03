-- Pair Brain Schema Migration
-- Adds Apple Music integration, user events, taste vectors, and release radar

-- ============================================
-- CANONICAL TRACK MODEL (PairTrack)
-- ============================================

-- Main track table with Apple Music as primary identifier
CREATE TABLE IF NOT EXISTS pair_tracks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    apple_music_id TEXT UNIQUE NOT NULL,
    spotify_id TEXT,
    isrc TEXT,
    
    track_name TEXT NOT NULL,
    artist_name TEXT NOT NULL,
    album_name TEXT,
    album_art_url TEXT,
    preview_url TEXT,
    duration_ms INT,
    release_date DATE,
    
    energy FLOAT,
    valence FLOAT,
    danceability FLOAT,
    acousticness FLOAT,
    instrumentalness FLOAT,
    tempo FLOAT,
    loudness FLOAT,
    
    genres TEXT[],
    mood_tags TEXT[],
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    source TEXT DEFAULT 'apple_music',
    last_synced_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_pair_tracks_apple_music_id ON pair_tracks(apple_music_id);
CREATE INDEX IF NOT EXISTS idx_pair_tracks_spotify_id ON pair_tracks(spotify_id);
CREATE INDEX IF NOT EXISTS idx_pair_tracks_isrc ON pair_tracks(isrc);
CREATE INDEX IF NOT EXISTS idx_pair_tracks_artist ON pair_tracks(artist_name);
CREATE INDEX IF NOT EXISTS idx_pair_tracks_release_date ON pair_tracks(release_date DESC);

-- ============================================
-- USER LIBRARY (Owned/Saved Tracks)
-- ============================================

CREATE TABLE IF NOT EXISTS user_library (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    track_id UUID NOT NULL REFERENCES pair_tracks(id) ON DELETE CASCADE,
    state TEXT NOT NULL CHECK (state IN ('owned', 'liked', 'archived')) DEFAULT 'owned',
    source TEXT CHECK (source IN ('discovery', 'manual', 'import', 'release_radar')),
    added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    state_changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, track_id)
);

CREATE INDEX IF NOT EXISTS idx_user_library_user_id ON user_library(user_id);
CREATE INDEX IF NOT EXISTS idx_user_library_state ON user_library(user_id, state);
CREATE INDEX IF NOT EXISTS idx_user_library_track_id ON user_library(track_id);

-- ============================================
-- USER EVENTS PIPELINE
-- ============================================

CREATE TABLE IF NOT EXISTS user_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    track_id UUID NOT NULL REFERENCES pair_tracks(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'viewed', 'preview_play', 'preview_complete', 'skip',
        'like', 'unlike', 'save', 'unsave', 'share', 'play_full'
    )),
    context TEXT,
    session_id TEXT,
    duration_ms INT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_events_user_id ON user_events(user_id);
CREATE INDEX IF NOT EXISTS idx_user_events_track_id ON user_events(track_id);
CREATE INDEX IF NOT EXISTS idx_user_events_type ON user_events(user_id, event_type);
CREATE INDEX IF NOT EXISTS idx_user_events_created ON user_events(created_at DESC);

-- ============================================
-- USER TASTE VECTORS
-- ============================================

CREATE TABLE IF NOT EXISTS user_taste_vectors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    preferred_energy FLOAT,
    preferred_valence FLOAT,
    preferred_danceability FLOAT,
    preferred_acousticness FLOAT,
    preferred_instrumentalness FLOAT,
    preferred_tempo FLOAT,
    positive_track_count INT DEFAULT 0,
    negative_track_count INT DEFAULT 0,
    computed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    version INT DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_user_taste_vectors_user_id ON user_taste_vectors(user_id);

-- ============================================
-- PUSH NOTIFICATION TOKENS
-- ============================================

CREATE TABLE IF NOT EXISTS push_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_token TEXT NOT NULL,
    platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
    is_active BOOLEAN DEFAULT TRUE,
    last_used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, device_token)
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_user_id ON push_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_push_tokens_active ON push_tokens(is_active) WHERE is_active = TRUE;

-- ============================================
-- RELEASE RADAR
-- ============================================

CREATE TABLE IF NOT EXISTS release_radar_candidates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    track_id UUID NOT NULL REFERENCES pair_tracks(id) ON DELETE CASCADE,
    ingested_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    source TEXT NOT NULL,
    processed BOOLEAN DEFAULT FALSE,
    processed_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(track_id)
);

CREATE INDEX IF NOT EXISTS idx_release_radar_processed ON release_radar_candidates(processed, ingested_at DESC);

CREATE TABLE IF NOT EXISTS release_radar_matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    track_id UUID NOT NULL REFERENCES pair_tracks(id) ON DELETE CASCADE,
    match_score FLOAT NOT NULL,
    match_reason TEXT,
    notified BOOLEAN DEFAULT FALSE,
    notified_at TIMESTAMP WITH TIME ZONE,
    viewed BOOLEAN DEFAULT FALSE,
    viewed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, track_id)
);

CREATE INDEX IF NOT EXISTS idx_release_radar_matches_user ON release_radar_matches(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_release_radar_matches_notified ON release_radar_matches(notified) WHERE notified = FALSE;

-- ============================================
-- UPDATE EXISTING TABLES FOR APPLE MUSIC
-- ============================================

ALTER TABLE prompts ADD COLUMN IF NOT EXISTS seed_track_apple_id TEXT;
ALTER TABLE prompts ADD COLUMN IF NOT EXISTS seed_pair_track_id UUID REFERENCES pair_tracks(id);
ALTER TABLE recommendations ADD COLUMN IF NOT EXISTS pair_track_id UUID REFERENCES pair_tracks(id);
ALTER TABLE recommendations ADD COLUMN IF NOT EXISTS apple_music_id TEXT;

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

ALTER TABLE pair_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_library ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_taste_vectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE release_radar_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE release_radar_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tracks are publicly readable" ON pair_tracks FOR SELECT USING (true);

CREATE POLICY "Users can read own library" ON user_library FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert to own library" ON user_library FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own library" ON user_library FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete from own library" ON user_library FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can read own events" ON user_events FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own events" ON user_events FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can read own taste vector" ON user_taste_vectors FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can read own push tokens" ON push_tokens FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own push tokens" ON push_tokens FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own push tokens" ON push_tokens FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own push tokens" ON push_tokens FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can read own radar matches" ON release_radar_matches FOR SELECT USING (auth.uid() = user_id);

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

CREATE OR REPLACE FUNCTION is_track_owned(p_user_id UUID, p_track_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM user_library 
        WHERE user_id = p_user_id AND track_id = p_track_id AND state = 'owned'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_owned_track_ids(p_user_id UUID)
RETURNS TABLE(track_id UUID) AS $$
BEGIN
    RETURN QUERY SELECT ul.track_id FROM user_library ul WHERE ul.user_id = p_user_id AND ul.state = 'owned';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION log_user_event(
    p_user_id UUID, p_track_id UUID, p_event_type TEXT,
    p_context TEXT DEFAULT NULL, p_session_id TEXT DEFAULT NULL, p_duration_ms INT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE v_event_id UUID;
BEGIN
    INSERT INTO user_events (user_id, track_id, event_type, context, session_id, duration_ms)
    VALUES (p_user_id, p_track_id, p_event_type, p_context, p_session_id, p_duration_ms)
    RETURNING id INTO v_event_id;
    RETURN v_event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION update_library_state_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.state IS DISTINCT FROM NEW.state THEN
        NEW.state_changed_at = NOW();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_library_state ON user_library;
CREATE TRIGGER trigger_update_library_state
    BEFORE UPDATE ON user_library
    FOR EACH ROW EXECUTE FUNCTION update_library_state_timestamp();
