import { createClient, SupabaseClient } from "@supabase/supabase-js";

let supabaseInstance: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!supabaseInstance) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing Supabase credentials");
    }
    
    supabaseInstance = createClient(supabaseUrl, supabaseServiceKey);
  }
  return supabaseInstance;
}

export const supabase = {
  from: (table: string) => getSupabase().from(table),
};

export interface User {
  id: string;
  created_at: string;
}

export interface Profile {
  user_id: string;
  username: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  created_at: string;
}

export interface Prompt {
  id: string;
  user_id: string;
  seed_track_id: string;
  seed_track_name: string | null;
  seed_artist_name: string | null;
  prompt_text: string | null;
  mode: string;
  created_at: string;
}

export interface Recommendation {
  id: string;
  prompt_id: string;
  track_id: string;
  track_name: string | null;
  artist_name: string | null;
  preview_url: string | null;
  spotify_url: string | null;
  score: number | null;
  explanation: string | null;
  rank: number | null;
  created_at: string;
}

export interface SavedTrack {
  id: string;
  user_id: string;
  track_id: string;
  track_name: string | null;
  artist_name: string | null;
  preview_url: string | null;
  spotify_url: string | null;
  created_at: string;
}

export interface Playlist {
  id: string;
  owner_id: string;
  title: string;
  prompt_text: string | null;
  seed_track_id: string | null;
  seed_track_name: string | null;
  seed_artist_name: string | null;
  mode: string | null;
  is_public: boolean;
  created_at: string;
}

export interface PlaylistTrack {
  id: string;
  playlist_id: string;
  track_id: string;
  track_name: string | null;
  artist_name: string | null;
  preview_url: string | null;
  spotify_url: string | null;
  score: number | null;
  explanation: string | null;
  rank: number | null;
}

export interface Follow {
  follower_id: string;
  followee_id: string;
  created_at: string;
}

export interface PlaylistLike {
  user_id: string;
  playlist_id: string;
  created_at: string;
}
