-- Pair Curator Engine v1 Schema (Fixed)
-- Weekly drops by genre with confidence-gated recommendations
-- "Pair is not a recommender feed. It's a high-precision curator."

-- ============================================
-- ENSURE pair_tracks TABLE EXISTS FIRST
-- ============================================

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
-- ENSURE user_taste_vectors TABLE EXISTS
-- ============================================

CREATE TABLE IF NOT EXISTS user_taste_vectors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
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
-- USER SETTINGS (Timezone + Preferences)
-- ============================================

CREATE TABLE IF NOT EXISTS user_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    timezone TEXT DEFAULT 'America/Los_Angeles',
    weekly_drop_local_time TIME DEFAULT '22:00',
    confidence_threshold FLOAT DEFAULT 0.84,
    adventure_mode BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON user_settings(user_id);

-- ============================================
-- USER MUSIC ACCOUNTS (Apple Music Connection)
-- ============================================

CREATE TABLE IF NOT EXISTS user_music_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('apple_music', 'spotify')),
    provider_user_id TEXT,
    music_user_token TEXT,
    refresh_token TEXT,
    token_expires_at TIMESTAMP WITH TIME ZONE,
    apple_pair_playlist_id TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    connected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_synced_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_user_music_accounts_user_id ON user_music_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_user_music_accounts_provider ON user_music_accounts(provider);

-- ============================================
-- TRACK FEATURES (Audio Analysis)
-- ============================================

CREATE TABLE IF NOT EXISTS pair_track_features (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    track_id UUID NOT NULL REFERENCES pair_tracks(id) ON DELETE CASCADE,
    bpm FLOAT,
    energy FLOAT,
    danceability FLOAT,
    valence FLOAT,
    acousticness FLOAT,
    instrumentalness FLOAT,
    liveness FLOAT,
    speechiness FLOAT,
    loudness FLOAT,
    key INT,
    mode INT,
    time_signature INT,
    feature_version INT DEFAULT 1,
    feature_source TEXT DEFAULT 'estimated',
    computed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(track_id)
);

CREATE INDEX IF NOT EXISTS idx_pair_track_features_track_id ON pair_track_features(track_id);

-- ============================================
-- CURATED GENRES (Controlled Vocabulary)
-- ============================================

CREATE TABLE IF NOT EXISTS curated_genres (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    descriptor TEXT,
    apple_genre_ids TEXT[],
    search_keywords TEXT[],
    is_active BOOLEAN DEFAULT TRUE,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default curated genres
INSERT INTO curated_genres (slug, display_name, descriptor, search_keywords, sort_order) VALUES
    ('melodic-electronic', 'Melodic Electronic', 'Atmospheric builds and emotional drops', ARRAY['melodic house', 'progressive house', 'deep house', 'melodic techno', 'anjunadeep'], 1),
    ('indie-dance', 'Indie Dance', 'Where indie meets the dancefloor', ARRAY['indie dance', 'nu disco', 'indie electronic', 'synth pop'], 2),
    ('alt-rnb', 'Alt R&B', 'Experimental soul and future R&B', ARRAY['alternative r&b', 'neo soul', 'experimental r&b', 'pnb'], 3),
    ('post-rock', 'Post-Rock', 'Cinematic builds and textured soundscapes', ARRAY['post-rock', 'ambient rock', 'shoegaze', 'dream pop'], 4),
    ('dream-pop', 'Dream Pop', 'Hazy melodies and ethereal vocals', ARRAY['dream pop', 'shoegaze', 'ethereal', 'chillwave'], 5),
    ('minimal-techno', 'Minimal Techno', 'Hypnotic loops and subtle evolution', ARRAY['minimal techno', 'minimal house', 'microhouse', 'tech house'], 6),
    ('indie-folk', 'Indie Folk', 'Intimate storytelling and acoustic warmth', ARRAY['indie folk', 'folk rock', 'americana', 'singer-songwriter'], 7),
    ('jazz-fusion', 'Jazz Fusion', 'Where jazz meets everything else', ARRAY['jazz fusion', 'nu jazz', 'jazz funk', 'contemporary jazz'], 8)
ON CONFLICT (slug) DO NOTHING;

-- ============================================
-- USER GENRE PREFERENCES
-- ============================================

CREATE TABLE IF NOT EXISTS user_genre_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    genre_id UUID NOT NULL REFERENCES curated_genres(id) ON DELETE CASCADE,
    weight FLOAT DEFAULT 1.0,
    is_active BOOLEAN DEFAULT TRUE,
    added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, genre_id)
);

CREATE INDEX IF NOT EXISTS idx_user_genre_preferences_user_id ON user_genre_preferences(user_id);

-- ============================================
-- ENHANCED USER TASTE VECTORS
-- ============================================

ALTER TABLE user_taste_vectors ADD COLUMN IF NOT EXISTS preferred_loudness FLOAT;
ALTER TABLE user_taste_vectors ADD COLUMN IF NOT EXISTS preferred_genres JSONB DEFAULT '{}';
ALTER TABLE user_taste_vectors ADD COLUMN IF NOT EXISTS audio_centroid JSONB;
ALTER TABLE user_taste_vectors ADD COLUMN IF NOT EXISTS audio_spread JSONB;
ALTER TABLE user_taste_vectors ADD COLUMN IF NOT EXISTS era_preference TEXT;
ALTER TABLE user_taste_vectors ADD COLUMN IF NOT EXISTS total_pairings INT DEFAULT 0;
ALTER TABLE user_taste_vectors ADD COLUMN IF NOT EXISTS successful_pairings INT DEFAULT 0;
ALTER TABLE user_taste_vectors ADD COLUMN IF NOT EXISTS mode_success_rates JSONB DEFAULT '{}';

-- ============================================
-- WEEKLY CANDIDATES (Retrieval Pool)
-- ============================================

CREATE TABLE IF NOT EXISTS weekly_candidates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    week_start_date DATE NOT NULL,
    genre_id UUID NOT NULL REFERENCES curated_genres(id) ON DELETE CASCADE,
    track_id UUID NOT NULL REFERENCES pair_tracks(id) ON DELETE CASCADE,
    source TEXT NOT NULL CHECK (source IN ('new_release', 'chart', 'editorial', 'artist_follow', 'related_artist', 'playlist_cooccurrence')),
    source_detail TEXT,
    retrieved_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(week_start_date, genre_id, track_id)
);

CREATE INDEX IF NOT EXISTS idx_weekly_candidates_week ON weekly_candidates(week_start_date);
CREATE INDEX IF NOT EXISTS idx_weekly_candidates_genre ON weekly_candidates(genre_id);
CREATE INDEX IF NOT EXISTS idx_weekly_candidates_track ON weekly_candidates(track_id);

-- ============================================
-- WEEKLY DROPS (Generated Recommendations)
-- ============================================

CREATE TABLE IF NOT EXISTS weekly_drops (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    week_start_date DATE NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'generating', 'generated', 'empty', 'failed')) DEFAULT 'pending',
    total_tracks INT DEFAULT 0,
    notified BOOLEAN DEFAULT FALSE,
    notified_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, week_start_date)
);

CREATE INDEX IF NOT EXISTS idx_weekly_drops_user ON weekly_drops(user_id);
CREATE INDEX IF NOT EXISTS idx_weekly_drops_week ON weekly_drops(week_start_date);
CREATE INDEX IF NOT EXISTS idx_weekly_drops_status ON weekly_drops(status);

-- ============================================
-- WEEKLY DROP TRACKS (Per-Genre Selections)
-- ============================================

CREATE TABLE IF NOT EXISTS weekly_drop_tracks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    weekly_drop_id UUID NOT NULL REFERENCES weekly_drops(id) ON DELETE CASCADE,
    genre_id UUID NOT NULL REFERENCES curated_genres(id) ON DELETE CASCADE,
    track_id UUID NOT NULL REFERENCES pair_tracks(id) ON DELETE CASCADE,
    position INT NOT NULL CHECK (position BETWEEN 1 AND 5),
    confidence FLOAT NOT NULL,
    audio_sim FLOAT,
    text_sim FLOAT,
    scene_sim FLOAT,
    reason TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(weekly_drop_id, genre_id, position)
);

CREATE INDEX IF NOT EXISTS idx_weekly_drop_tracks_drop ON weekly_drop_tracks(weekly_drop_id);
CREATE INDEX IF NOT EXISTS idx_weekly_drop_tracks_genre ON weekly_drop_tracks(genre_id);

-- ============================================
-- PAIRING INTERACTIONS (Learning Signals)
-- ============================================

CREATE TABLE IF NOT EXISTS pairing_interactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    track_id UUID NOT NULL REFERENCES pair_tracks(id) ON DELETE CASCADE,
    weekly_drop_id UUID REFERENCES weekly_drops(id) ON DELETE SET NULL,
    interaction_type TEXT NOT NULL CHECK (interaction_type IN (
        'preview_started', 'preview_completed', 'liked', 'disliked', 
        'saved', 'skipped', 'shared', 'played_full'
    )),
    preview_duration_ms INT,
    context TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pairing_interactions_user ON pairing_interactions(user_id);
CREATE INDEX IF NOT EXISTS idx_pairing_interactions_track ON pairing_interactions(track_id);
CREATE INDEX IF NOT EXISTS idx_pairing_interactions_type ON pairing_interactions(interaction_type);
CREATE INDEX IF NOT EXISTS idx_pairing_interactions_created ON pairing_interactions(created_at DESC);

-- ============================================
-- USER OWNED TRACKS (Hard Filter)
-- ============================================

CREATE TABLE IF NOT EXISTS user_owned_tracks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    track_id UUID REFERENCES pair_tracks(id) ON DELETE SET NULL,
    apple_music_id TEXT NOT NULL,
    source TEXT CHECK (source IN ('library', 'playlist', 'recent', 'loved', 'pair_saved')),
    added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, apple_music_id)
);

CREATE INDEX IF NOT EXISTS idx_user_owned_tracks_user ON user_owned_tracks(user_id);
CREATE INDEX IF NOT EXISTS idx_user_owned_tracks_apple ON user_owned_tracks(apple_music_id);

-- ============================================
-- USER DISLIKED TRACKS (Hard Filter)
-- ============================================

CREATE TABLE IF NOT EXISTS user_disliked_tracks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    track_id UUID REFERENCES pair_tracks(id) ON DELETE SET NULL,
    apple_music_id TEXT NOT NULL,
    disliked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, apple_music_id)
);

CREATE INDEX IF NOT EXISTS idx_user_disliked_tracks_user ON user_disliked_tracks(user_id);
CREATE INDEX IF NOT EXISTS idx_user_disliked_tracks_apple ON user_disliked_tracks(apple_music_id);

-- ============================================
-- PAIRING HISTORY (For Cooldown)
-- ============================================

CREATE TABLE IF NOT EXISTS pairing_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    session_id TEXT,
    seed_track_id UUID REFERENCES pair_tracks(id) ON DELETE SET NULL,
    recommended_track_id UUID REFERENCES pair_tracks(id) ON DELETE SET NULL,
    mode TEXT,
    slot_type TEXT,
    slot_position INT,
    similarity_score FLOAT,
    audio_similarity FLOAT,
    text_similarity FLOAT,
    scene_similarity FLOAT,
    explanation TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pairing_history_user ON pairing_history(user_id);
CREATE INDEX IF NOT EXISTS idx_pairing_history_session ON pairing_history(session_id);
CREATE INDEX IF NOT EXISTS idx_pairing_history_created ON pairing_history(created_at DESC);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

ALTER TABLE pair_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_taste_vectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_music_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE pair_track_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE curated_genres ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_genre_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_drops ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_drop_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE pairing_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_owned_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_disliked_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE pairing_history ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "Tracks are publicly readable" ON pair_tracks;
DROP POLICY IF EXISTS "Genres are publicly readable" ON curated_genres;
DROP POLICY IF EXISTS "Track features are publicly readable" ON pair_track_features;
DROP POLICY IF EXISTS "Weekly candidates are publicly readable" ON weekly_candidates;

-- Public read policies
CREATE POLICY "Tracks are publicly readable" ON pair_tracks FOR SELECT USING (true);
CREATE POLICY "Genres are publicly readable" ON curated_genres FOR SELECT USING (true);
CREATE POLICY "Track features are publicly readable" ON pair_track_features FOR SELECT USING (true);
CREATE POLICY "Weekly candidates are publicly readable" ON weekly_candidates FOR SELECT USING (true);

-- Drop existing user policies if they exist
DROP POLICY IF EXISTS "Users can read own taste vector" ON user_taste_vectors;
DROP POLICY IF EXISTS "Users can read own settings" ON user_settings;
DROP POLICY IF EXISTS "Users can insert own settings" ON user_settings;
DROP POLICY IF EXISTS "Users can update own settings" ON user_settings;

-- User taste vectors policies
CREATE POLICY "Users can read own taste vector" ON user_taste_vectors FOR SELECT USING (auth.uid() = user_id);

-- User settings policies
CREATE POLICY "Users can read own settings" ON user_settings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own settings" ON user_settings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own settings" ON user_settings FOR UPDATE USING (auth.uid() = user_id);

-- Drop existing music account policies
DROP POLICY IF EXISTS "Users can read own music accounts" ON user_music_accounts;
DROP POLICY IF EXISTS "Users can insert own music accounts" ON user_music_accounts;
DROP POLICY IF EXISTS "Users can update own music accounts" ON user_music_accounts;
DROP POLICY IF EXISTS "Users can delete own music accounts" ON user_music_accounts;

CREATE POLICY "Users can read own music accounts" ON user_music_accounts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own music accounts" ON user_music_accounts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own music accounts" ON user_music_accounts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own music accounts" ON user_music_accounts FOR DELETE USING (auth.uid() = user_id);

-- Drop existing genre preference policies
DROP POLICY IF EXISTS "Users can read own genre preferences" ON user_genre_preferences;
DROP POLICY IF EXISTS "Users can insert own genre preferences" ON user_genre_preferences;
DROP POLICY IF EXISTS "Users can update own genre preferences" ON user_genre_preferences;
DROP POLICY IF EXISTS "Users can delete own genre preferences" ON user_genre_preferences;

CREATE POLICY "Users can read own genre preferences" ON user_genre_preferences FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own genre preferences" ON user_genre_preferences FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own genre preferences" ON user_genre_preferences FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own genre preferences" ON user_genre_preferences FOR DELETE USING (auth.uid() = user_id);

-- Drop existing weekly drop policies
DROP POLICY IF EXISTS "Users can read own weekly drops" ON weekly_drops;
DROP POLICY IF EXISTS "Users can read own drop tracks" ON weekly_drop_tracks;

CREATE POLICY "Users can read own weekly drops" ON weekly_drops FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can read own drop tracks" ON weekly_drop_tracks FOR SELECT 
    USING (EXISTS (SELECT 1 FROM weekly_drops WHERE weekly_drops.id = weekly_drop_tracks.weekly_drop_id AND weekly_drops.user_id = auth.uid()));

-- Drop existing interaction policies
DROP POLICY IF EXISTS "Users can read own interactions" ON pairing_interactions;
DROP POLICY IF EXISTS "Users can insert own interactions" ON pairing_interactions;

CREATE POLICY "Users can read own interactions" ON pairing_interactions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own interactions" ON pairing_interactions FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Drop existing owned tracks policies
DROP POLICY IF EXISTS "Users can read own owned tracks" ON user_owned_tracks;
DROP POLICY IF EXISTS "Users can insert own owned tracks" ON user_owned_tracks;
DROP POLICY IF EXISTS "Users can delete own owned tracks" ON user_owned_tracks;

CREATE POLICY "Users can read own owned tracks" ON user_owned_tracks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own owned tracks" ON user_owned_tracks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own owned tracks" ON user_owned_tracks FOR DELETE USING (auth.uid() = user_id);

-- Drop existing disliked tracks policies
DROP POLICY IF EXISTS "Users can read own disliked tracks" ON user_disliked_tracks;
DROP POLICY IF EXISTS "Users can insert own disliked tracks" ON user_disliked_tracks;
DROP POLICY IF EXISTS "Users can delete own disliked tracks" ON user_disliked_tracks;

CREATE POLICY "Users can read own disliked tracks" ON user_disliked_tracks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own disliked tracks" ON user_disliked_tracks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own disliked tracks" ON user_disliked_tracks FOR DELETE USING (auth.uid() = user_id);

-- Drop existing pairing history policies
DROP POLICY IF EXISTS "Users can read own pairing history" ON pairing_history;
DROP POLICY IF EXISTS "Users can insert own pairing history" ON pairing_history;

CREATE POLICY "Users can read own pairing history" ON pairing_history FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own pairing history" ON pairing_history FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ============================================
-- SERVICE ROLE POLICIES (for API operations)
-- ============================================

DROP POLICY IF EXISTS "Service role full access to pair_tracks" ON pair_tracks;
DROP POLICY IF EXISTS "Service role full access to user_taste_vectors" ON user_taste_vectors;
DROP POLICY IF EXISTS "Service role full access to user_settings" ON user_settings;
DROP POLICY IF EXISTS "Service role full access to user_music_accounts" ON user_music_accounts;
DROP POLICY IF EXISTS "Service role full access to pair_track_features" ON pair_track_features;
DROP POLICY IF EXISTS "Service role full access to curated_genres" ON curated_genres;
DROP POLICY IF EXISTS "Service role full access to user_genre_preferences" ON user_genre_preferences;
DROP POLICY IF EXISTS "Service role full access to weekly_candidates" ON weekly_candidates;
DROP POLICY IF EXISTS "Service role full access to weekly_drops" ON weekly_drops;
DROP POLICY IF EXISTS "Service role full access to weekly_drop_tracks" ON weekly_drop_tracks;
DROP POLICY IF EXISTS "Service role full access to pairing_interactions" ON pairing_interactions;
DROP POLICY IF EXISTS "Service role full access to user_owned_tracks" ON user_owned_tracks;
DROP POLICY IF EXISTS "Service role full access to user_disliked_tracks" ON user_disliked_tracks;
DROP POLICY IF EXISTS "Service role full access to pairing_history" ON pairing_history;

CREATE POLICY "Service role full access to pair_tracks" ON pair_tracks FOR ALL USING (true);
CREATE POLICY "Service role full access to user_taste_vectors" ON user_taste_vectors FOR ALL USING (true);
CREATE POLICY "Service role full access to user_settings" ON user_settings FOR ALL USING (true);
CREATE POLICY "Service role full access to user_music_accounts" ON user_music_accounts FOR ALL USING (true);
CREATE POLICY "Service role full access to pair_track_features" ON pair_track_features FOR ALL USING (true);
CREATE POLICY "Service role full access to curated_genres" ON curated_genres FOR ALL USING (true);
CREATE POLICY "Service role full access to user_genre_preferences" ON user_genre_preferences FOR ALL USING (true);
CREATE POLICY "Service role full access to weekly_candidates" ON weekly_candidates FOR ALL USING (true);
CREATE POLICY "Service role full access to weekly_drops" ON weekly_drops FOR ALL USING (true);
CREATE POLICY "Service role full access to weekly_drop_tracks" ON weekly_drop_tracks FOR ALL USING (true);
CREATE POLICY "Service role full access to pairing_interactions" ON pairing_interactions FOR ALL USING (true);
CREATE POLICY "Service role full access to user_owned_tracks" ON user_owned_tracks FOR ALL USING (true);
CREATE POLICY "Service role full access to user_disliked_tracks" ON user_disliked_tracks FOR ALL USING (true);
CREATE POLICY "Service role full access to pairing_history" ON pairing_history FOR ALL USING (true);

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

CREATE OR REPLACE FUNCTION get_current_week_friday()
RETURNS DATE AS $$
BEGIN
    RETURN date_trunc('week', CURRENT_DATE) + INTERVAL '4 days';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION should_generate_weekly_drop(p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_timezone TEXT;
    v_drop_time TIME;
    v_local_time TIMESTAMP WITH TIME ZONE;
    v_week_friday DATE;
    v_existing_drop UUID;
BEGIN
    SELECT timezone, weekly_drop_local_time INTO v_timezone, v_drop_time
    FROM user_settings WHERE user_id = p_user_id;
    
    IF v_timezone IS NULL THEN
        v_timezone := 'America/Los_Angeles';
        v_drop_time := '22:00';
    END IF;
    
    v_local_time := NOW() AT TIME ZONE v_timezone;
    v_week_friday := get_current_week_friday();
    
    SELECT id INTO v_existing_drop
    FROM weekly_drops
    WHERE user_id = p_user_id AND week_start_date = v_week_friday;
    
    IF v_existing_drop IS NOT NULL THEN
        RETURN FALSE;
    END IF;
    
    IF (v_local_time::DATE = v_week_friday - INTERVAL '1 day' AND v_local_time::TIME >= v_drop_time)
       OR v_local_time::DATE >= v_week_friday THEN
        RETURN TRUE;
    END IF;
    
    RETURN FALSE;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_user_active_genres(p_user_id UUID)
RETURNS TABLE(genre_id UUID, slug TEXT, display_name TEXT, weight FLOAT) AS $$
BEGIN
    RETURN QUERY
    SELECT cg.id, cg.slug, cg.display_name, COALESCE(ugp.weight, 1.0)
    FROM curated_genres cg
    LEFT JOIN user_genre_preferences ugp ON cg.id = ugp.genre_id AND ugp.user_id = p_user_id
    WHERE cg.is_active = TRUE
    AND (ugp.is_active = TRUE OR ugp.id IS NULL)
    ORDER BY cg.sort_order;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_user_settings_updated_at ON user_settings;
CREATE TRIGGER trigger_user_settings_updated_at
    BEFORE UPDATE ON user_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
