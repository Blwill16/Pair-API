-- Pair Algorithm v1 Migration
-- Implements the 6-track pairing engine with learning loop

-- Table to track pairing history (what tracks were shown to users)
CREATE TABLE IF NOT EXISTS pairing_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL,
    seed_track_id UUID REFERENCES pair_tracks(id),
    recommended_track_id UUID REFERENCES pair_tracks(id),
    slot_type TEXT NOT NULL CHECK (slot_type IN ('core', 'flavor', 'wildcard')),
    slot_position INTEGER NOT NULL CHECK (slot_position >= 1 AND slot_position <= 6),
    mode TEXT NOT NULL CHECK (mode IN ('same_sound', 'same_vibe', 'same_scene', 'adventure')),
    similarity_score DECIMAL(5,4),
    audio_similarity DECIMAL(5,4),
    text_similarity DECIMAL(5,4),
    scene_similarity DECIMAL(5,4),
    explanation TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(session_id, slot_position)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_pairing_history_user ON pairing_history(user_id);
CREATE INDEX IF NOT EXISTS idx_pairing_history_session ON pairing_history(session_id);
CREATE INDEX IF NOT EXISTS idx_pairing_history_track ON pairing_history(recommended_track_id);

-- Table to track user interactions with recommended tracks
CREATE TABLE IF NOT EXISTS pairing_interactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pairing_history_id UUID REFERENCES pairing_history(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    interaction_type TEXT NOT NULL CHECK (interaction_type IN (
        'preview_started', 'preview_completed', 'liked', 'disliked', 
        'saved', 'skipped', 'added_to_playlist'
    )),
    duration_ms INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pairing_interactions_user ON pairing_interactions(user_id);
CREATE INDEX IF NOT EXISTS idx_pairing_interactions_history ON pairing_interactions(pairing_history_id);

-- Enhanced user taste vectors with more features
ALTER TABLE user_taste_vectors 
ADD COLUMN IF NOT EXISTS preferred_loudness DECIMAL(5,2) DEFAULT -10,
ADD COLUMN IF NOT EXISTS preferred_speechiness DECIMAL(5,4) DEFAULT 0.1,
ADD COLUMN IF NOT EXISTS preferred_liveness DECIMAL(5,4) DEFAULT 0.2,
ADD COLUMN IF NOT EXISTS genre_weights JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS era_preference TEXT DEFAULT 'any',
ADD COLUMN IF NOT EXISTS vocal_preference TEXT DEFAULT 'any' CHECK (vocal_preference IN ('any', 'vocal', 'instrumental')),
ADD COLUMN IF NOT EXISTS mode_success_rates JSONB DEFAULT '{"same_sound": 0.5, "same_vibe": 0.5, "same_scene": 0.5, "adventure": 0.5}',
ADD COLUMN IF NOT EXISTS total_pairings INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS successful_pairings INTEGER DEFAULT 0;

-- Table to track permanently disliked tracks (never show again)
CREATE TABLE IF NOT EXISTS user_disliked_tracks (
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    track_id UUID REFERENCES pair_tracks(id) ON DELETE CASCADE,
    apple_music_id TEXT NOT NULL,
    disliked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (user_id, track_id)
);

CREATE INDEX IF NOT EXISTS idx_user_disliked_apple_id ON user_disliked_tracks(user_id, apple_music_id);

-- Table to track tracks in user's playlists (never recommend again)
CREATE TABLE IF NOT EXISTS user_owned_tracks (
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    track_id UUID REFERENCES pair_tracks(id) ON DELETE CASCADE,
    apple_music_id TEXT NOT NULL,
    source TEXT DEFAULT 'playlist',
    added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (user_id, track_id)
);

CREATE INDEX IF NOT EXISTS idx_user_owned_apple_id ON user_owned_tracks(user_id, apple_music_id);

-- Add more audio features to pair_tracks for better matching
ALTER TABLE pair_tracks
ADD COLUMN IF NOT EXISTS loudness DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS speechiness DECIMAL(5,4),
ADD COLUMN IF NOT EXISTS liveness DECIMAL(5,4),
ADD COLUMN IF NOT EXISTS mode INTEGER,
ADD COLUMN IF NOT EXISTS time_signature INTEGER,
ADD COLUMN IF NOT EXISTS key INTEGER,
ADD COLUMN IF NOT EXISTS popularity INTEGER,
ADD COLUMN IF NOT EXISTS explicit BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS audio_features_extracted BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS embedding_vector VECTOR(128);

-- RLS Policies
ALTER TABLE pairing_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE pairing_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_disliked_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_owned_tracks ENABLE ROW LEVEL SECURITY;

-- Users can only see their own pairing history
CREATE POLICY "Users can view own pairing history" ON pairing_history
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own pairing history" ON pairing_history
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can only see their own interactions
CREATE POLICY "Users can view own interactions" ON pairing_interactions
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own interactions" ON pairing_interactions
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can only manage their own disliked tracks
CREATE POLICY "Users can view own disliked tracks" ON user_disliked_tracks
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own disliked tracks" ON user_disliked_tracks
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own disliked tracks" ON user_disliked_tracks
    FOR DELETE USING (auth.uid() = user_id);

-- Users can only manage their own owned tracks
CREATE POLICY "Users can view own owned tracks" ON user_owned_tracks
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own owned tracks" ON user_owned_tracks
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Service role can do everything (for API)
CREATE POLICY "Service role full access pairing_history" ON pairing_history
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access pairing_interactions" ON pairing_interactions
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access user_disliked_tracks" ON user_disliked_tracks
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access user_owned_tracks" ON user_owned_tracks
    FOR ALL USING (auth.role() = 'service_role');
