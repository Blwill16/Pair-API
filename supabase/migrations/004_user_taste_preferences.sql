-- User taste preferences table
-- Stores genres, moods, and eras selected during onboarding

CREATE TABLE IF NOT EXISTS user_taste_preferences (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    genres TEXT[] DEFAULT '{}',
    moods TEXT[] DEFAULT '{}',
    eras TEXT[] DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id)
);

-- Enable RLS
ALTER TABLE user_taste_preferences ENABLE ROW LEVEL SECURITY;

-- Users can read their own taste preferences
CREATE POLICY "Users can read own taste preferences"
    ON user_taste_preferences FOR SELECT
    USING (auth.uid() = user_id);

-- Users can insert their own taste preferences
CREATE POLICY "Users can insert own taste preferences"
    ON user_taste_preferences FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Users can update their own taste preferences
CREATE POLICY "Users can update own taste preferences"
    ON user_taste_preferences FOR UPDATE
    USING (auth.uid() = user_id);

-- Service role can manage all taste preferences (for API)
CREATE POLICY "Service role can manage all taste preferences"
    ON user_taste_preferences FOR ALL
    USING (true);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_taste_preferences_user_id ON user_taste_preferences(user_id);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_taste_preferences_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
DROP TRIGGER IF EXISTS trigger_update_taste_preferences_updated_at ON user_taste_preferences;
CREATE TRIGGER trigger_update_taste_preferences_updated_at
    BEFORE UPDATE ON user_taste_preferences
    FOR EACH ROW
    EXECUTE FUNCTION update_taste_preferences_updated_at();

-- Create storage bucket for profile avatars if it doesn't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for avatars bucket
CREATE POLICY "Anyone can view avatars"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'avatars');

CREATE POLICY "Authenticated users can upload avatars"
    ON storage.objects FOR INSERT
    WITH CHECK (bucket_id = 'avatars' AND auth.role() = 'authenticated');

CREATE POLICY "Users can update their own avatars"
    ON storage.objects FOR UPDATE
    USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete their own avatars"
    ON storage.objects FOR DELETE
    USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);
