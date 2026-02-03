-- Pair App Database Schema
-- Run this migration in your Supabase SQL editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table (synced with Supabase Auth)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Profiles table
CREATE TABLE IF NOT EXISTS profiles (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT,
    bio TEXT,
    avatar_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Prompts table (stores pairing requests)
CREATE TABLE IF NOT EXISTS prompts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    seed_track_id TEXT NOT NULL,
    seed_track_name TEXT,
    seed_artist_name TEXT,
    prompt_text TEXT,
    mode TEXT NOT NULL CHECK (mode IN ('same_sound', 'same_vibe', 'same_scene', 'adventure')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Recommendations table (stores pairing results)
CREATE TABLE IF NOT EXISTS recommendations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prompt_id UUID REFERENCES prompts(id) ON DELETE CASCADE,
    track_id TEXT NOT NULL,
    track_name TEXT,
    artist_name TEXT,
    preview_url TEXT,
    spotify_url TEXT,
    score FLOAT,
    explanation TEXT,
    rank INT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Saved tracks table
CREATE TABLE IF NOT EXISTS saved_tracks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    track_id TEXT NOT NULL,
    track_name TEXT,
    artist_name TEXT,
    preview_url TEXT,
    spotify_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, track_id)
);

-- Playlists table (shareable objects)
CREATE TABLE IF NOT EXISTS playlists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    prompt_text TEXT,
    seed_track_id TEXT,
    seed_track_name TEXT,
    seed_artist_name TEXT,
    mode TEXT,
    is_public BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Playlist tracks table
CREATE TABLE IF NOT EXISTS playlist_tracks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    playlist_id UUID REFERENCES playlists(id) ON DELETE CASCADE,
    track_id TEXT NOT NULL,
    track_name TEXT,
    artist_name TEXT,
    preview_url TEXT,
    spotify_url TEXT,
    score FLOAT,
    explanation TEXT,
    rank INT
);

-- Follows table
CREATE TABLE IF NOT EXISTS follows (
    follower_id UUID REFERENCES users(id) ON DELETE CASCADE,
    followee_id UUID REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (follower_id, followee_id)
);

-- Playlist likes table
CREATE TABLE IF NOT EXISTS playlist_likes (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    playlist_id UUID REFERENCES playlists(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (user_id, playlist_id)
);

-- Prompt remixes table (optional but powerful)
CREATE TABLE IF NOT EXISTS prompt_remixes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    source_playlist_id UUID REFERENCES playlists(id) ON DELETE SET NULL,
    new_prompt_text TEXT,
    mode TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_prompts_user_id ON prompts(user_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_prompt_id ON recommendations(prompt_id);
CREATE INDEX IF NOT EXISTS idx_saved_tracks_user_id ON saved_tracks(user_id);
CREATE INDEX IF NOT EXISTS idx_playlists_owner_id ON playlists(owner_id);
CREATE INDEX IF NOT EXISTS idx_playlists_is_public ON playlists(is_public);
CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist_id ON playlist_tracks(playlist_id);
CREATE INDEX IF NOT EXISTS idx_follows_follower_id ON follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_follows_followee_id ON follows(followee_id);
CREATE INDEX IF NOT EXISTS idx_playlist_likes_playlist_id ON playlist_likes(playlist_id);

-- Enable Row Level Security
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE playlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE playlist_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE playlist_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompt_remixes ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- Users: users can read their own data
CREATE POLICY "Users can read own data" ON users
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can insert own data" ON users
    FOR INSERT WITH CHECK (auth.uid() = id);

-- Profiles: public read, own write
CREATE POLICY "Profiles are publicly readable" ON profiles
    FOR SELECT USING (true);

CREATE POLICY "Users can update own profile" ON profiles
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own profile" ON profiles
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Prompts: own read/write
CREATE POLICY "Users can read own prompts" ON prompts
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own prompts" ON prompts
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Recommendations: read if owns the prompt
CREATE POLICY "Users can read own recommendations" ON recommendations
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM prompts WHERE prompts.id = recommendations.prompt_id AND prompts.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert recommendations for own prompts" ON recommendations
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM prompts WHERE prompts.id = recommendations.prompt_id AND prompts.user_id = auth.uid()
        )
    );

-- Saved tracks: own read/write
CREATE POLICY "Users can read own saved tracks" ON saved_tracks
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own saved tracks" ON saved_tracks
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own saved tracks" ON saved_tracks
    FOR DELETE USING (auth.uid() = user_id);

-- Playlists: public can read public playlists, owners can read/write all their playlists
CREATE POLICY "Public playlists are readable by all" ON playlists
    FOR SELECT USING (is_public = true OR auth.uid() = owner_id);

CREATE POLICY "Users can insert own playlists" ON playlists
    FOR INSERT WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update own playlists" ON playlists
    FOR UPDATE USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete own playlists" ON playlists
    FOR DELETE USING (auth.uid() = owner_id);

-- Playlist tracks: readable if playlist is public or owned
CREATE POLICY "Playlist tracks readable if playlist accessible" ON playlist_tracks
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM playlists 
            WHERE playlists.id = playlist_tracks.playlist_id 
            AND (playlists.is_public = true OR playlists.owner_id = auth.uid())
        )
    );

CREATE POLICY "Users can insert tracks to own playlists" ON playlist_tracks
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM playlists WHERE playlists.id = playlist_tracks.playlist_id AND playlists.owner_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete tracks from own playlists" ON playlist_tracks
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM playlists WHERE playlists.id = playlist_tracks.playlist_id AND playlists.owner_id = auth.uid()
        )
    );

-- Follows: users can manage their own follows
CREATE POLICY "Follows are publicly readable" ON follows
    FOR SELECT USING (true);

CREATE POLICY "Users can insert own follows" ON follows
    FOR INSERT WITH CHECK (auth.uid() = follower_id);

CREATE POLICY "Users can delete own follows" ON follows
    FOR DELETE USING (auth.uid() = follower_id);

-- Playlist likes: users can manage their own likes
CREATE POLICY "Playlist likes are publicly readable" ON playlist_likes
    FOR SELECT USING (true);

CREATE POLICY "Users can insert own likes" ON playlist_likes
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own likes" ON playlist_likes
    FOR DELETE USING (auth.uid() = user_id);

-- Prompt remixes: own read/write
CREATE POLICY "Users can read own remixes" ON prompt_remixes
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own remixes" ON prompt_remixes
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Function to automatically create user record on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.users (id)
    VALUES (NEW.id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to create user on signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
