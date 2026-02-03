// Last.fm API integration for similar tracks
// API docs: https://www.last.fm/api/show/track.getSimilar

const LASTFM_API_KEY = process.env.LASTFM_API_KEY || "";
const LASTFM_API_URL = "https://ws.audioscrobbler.com/2.0/";

export interface LastFmSimilarTrack {
  name: string;
  artist: {
    name: string;
  };
  match: number; // Similarity score 0-1
  mbid?: string; // MusicBrainz ID
}

export interface LastFmSimilarResponse {
  similartracks?: {
    track: LastFmSimilarTrack[];
  };
  error?: number;
  message?: string;
}

/**
 * Get similar tracks from Last.fm based on track name and artist
 * This uses Last.fm's listening data to find actually similar songs
 */
export async function getLastFmSimilarTracks(
  trackName: string,
  artistName: string,
  limit: number = 30
): Promise<LastFmSimilarTrack[]> {
  if (!LASTFM_API_KEY) {
    console.warn("LASTFM_API_KEY not configured, skipping Last.fm similar tracks");
    return [];
  }

  try {
    const params = new URLSearchParams({
      method: "track.getSimilar",
      track: trackName,
      artist: artistName,
      limit: limit.toString(),
      api_key: LASTFM_API_KEY,
      format: "json",
    });

    const response = await fetch(`${LASTFM_API_URL}?${params.toString()}`);
    
    if (!response.ok) {
      console.error(`Last.fm API error: ${response.status}`);
      return [];
    }

    const data: LastFmSimilarResponse = await response.json();
    
    if (data.error) {
      console.error(`Last.fm API error: ${data.message}`);
      return [];
    }

    if (!data.similartracks?.track) {
      return [];
    }

    // Return tracks sorted by match score
    return data.similartracks.track.sort((a, b) => b.match - a.match);
  } catch (error) {
    console.error("Error fetching Last.fm similar tracks:", error);
    return [];
  }
}

/**
 * Get similar artists from Last.fm
 */
export async function getLastFmSimilarArtists(
  artistName: string,
  limit: number = 10
): Promise<string[]> {
  if (!LASTFM_API_KEY) {
    return [];
  }

  try {
    const params = new URLSearchParams({
      method: "artist.getSimilar",
      artist: artistName,
      limit: limit.toString(),
      api_key: LASTFM_API_KEY,
      format: "json",
    });

    const response = await fetch(`${LASTFM_API_URL}?${params.toString()}`);
    
    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    
    if (data.error || !data.similarartists?.artist) {
      return [];
    }

    return data.similarartists.artist.map((a: { name: string }) => a.name);
  } catch (error) {
    console.error("Error fetching Last.fm similar artists:", error);
    return [];
  }
}

/**
 * Check if Last.fm API is configured
 */
export function isLastFmConfigured(): boolean {
  return !!LASTFM_API_KEY;
}
