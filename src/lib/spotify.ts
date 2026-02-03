import {
  mockSearchTracks,
  mockGetTrack,
  mockGetAudioFeatures,
  mockGetRecommendations,
  mockGetRelatedArtists,
  mockGetArtistTopTracks,
  mockGetArtistGenres,
} from "./mockData";

const MOCK_MODE = process.env.MOCK_SPOTIFY === "true";

let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getSpotifyToken(): Promise<string> {
  if (MOCK_MODE) {
    return "mock_token";
  }

  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing Spotify credentials");
  }

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) {
    throw new Error(`Failed to get Spotify token: ${response.statusText}`);
  }

  const data = await response.json();
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };

  return cachedToken.token;
}

export interface SpotifyTrack {
  track_id: string;
  track_name: string;
  artist_name: string;
  artist_id: string;
  album_art_url: string;
  preview_url: string | null;
  spotify_url: string;
}

export interface AudioFeatures {
  track_id: string;
  danceability: number;
  energy: number;
  valence: number;
  tempo: number;
  acousticness: number;
  instrumentalness: number;
  loudness: number;
}

export async function searchTracks(query: string, limit: number = 10): Promise<SpotifyTrack[]> {
  if (MOCK_MODE) {
    return mockSearchTracks(query, limit);
  }

  const token = await getSpotifyToken();
  
  const response = await fetch(
    `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=${limit}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (!response.ok) {
    throw new Error(`Spotify search failed: ${response.statusText}`);
  }

  const data = await response.json();
  
  return data.tracks.items.map((track: any) => ({
    track_id: track.id,
    track_name: track.name,
    artist_name: track.artists[0]?.name || "Unknown",
    artist_id: track.artists[0]?.id || "",
    album_art_url: track.album.images[0]?.url || "",
    preview_url: track.preview_url,
    spotify_url: track.external_urls.spotify,
  }));
}

export async function getAudioFeatures(trackIds: string[]): Promise<AudioFeatures[]> {
  if (MOCK_MODE) {
    return mockGetAudioFeatures(trackIds);
  }

  const token = await getSpotifyToken();
  
  const response = await fetch(
    `https://api.spotify.com/v1/audio-features?ids=${trackIds.join(",")}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to get audio features: ${response.statusText}`);
  }

  const data = await response.json();
  
  return data.audio_features
    .filter((f: any) => f !== null)
    .map((f: any) => ({
      track_id: f.id,
      danceability: f.danceability,
      energy: f.energy,
      valence: f.valence,
      tempo: f.tempo,
      acousticness: f.acousticness,
      instrumentalness: f.instrumentalness,
      loudness: f.loudness,
    }));
}

export async function getTrack(trackId: string): Promise<SpotifyTrack> {
  if (MOCK_MODE) {
    const track = mockGetTrack(trackId);
    if (!track) {
      throw new Error(`Track not found: ${trackId}`);
    }
    return track;
  }

  const token = await getSpotifyToken();
  
  const response = await fetch(
    `https://api.spotify.com/v1/tracks/${trackId}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to get track: ${response.statusText}`);
  }

  const track = await response.json();
  
  return {
    track_id: track.id,
    track_name: track.name,
    artist_name: track.artists[0]?.name || "Unknown",
    artist_id: track.artists[0]?.id || "",
    album_art_url: track.album.images[0]?.url || "",
    preview_url: track.preview_url,
    spotify_url: track.external_urls.spotify,
  };
}

export async function getRecommendations(
  seedTrackId: string,
  limit: number = 100
): Promise<SpotifyTrack[]> {
  if (MOCK_MODE) {
    return mockGetRecommendations(seedTrackId, limit);
  }

  const token = await getSpotifyToken();
  
  const response = await fetch(
    `https://api.spotify.com/v1/recommendations?seed_tracks=${seedTrackId}&limit=${limit}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to get recommendations: ${response.statusText}`);
  }

  const data = await response.json();
  
  return data.tracks.map((track: any) => ({
    track_id: track.id,
    track_name: track.name,
    artist_name: track.artists[0]?.name || "Unknown",
    artist_id: track.artists[0]?.id || "",
    album_art_url: track.album.images[0]?.url || "",
    preview_url: track.preview_url,
    spotify_url: track.external_urls.spotify,
  }));
}

export async function getRelatedArtists(artistId: string): Promise<string[]> {
  if (MOCK_MODE) {
    return mockGetRelatedArtists(artistId);
  }

  const token = await getSpotifyToken();
  
  const response = await fetch(
    `https://api.spotify.com/v1/artists/${artistId}/related-artists`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to get related artists: ${response.statusText}`);
  }

  const data = await response.json();
  return data.artists.slice(0, 10).map((a: any) => a.id);
}

export async function getArtistTopTracks(artistId: string): Promise<SpotifyTrack[]> {
  if (MOCK_MODE) {
    return mockGetArtistTopTracks(artistId);
  }

  const token = await getSpotifyToken();
  
  const response = await fetch(
    `https://api.spotify.com/v1/artists/${artistId}/top-tracks?market=US`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to get artist top tracks: ${response.statusText}`);
  }

  const data = await response.json();
  
  return data.tracks.slice(0, 5).map((track: any) => ({
    track_id: track.id,
    track_name: track.name,
    artist_name: track.artists[0]?.name || "Unknown",
    artist_id: track.artists[0]?.id || "",
    album_art_url: track.album.images[0]?.url || "",
    preview_url: track.preview_url,
    spotify_url: track.external_urls.spotify,
  }));
}

export async function getArtistGenres(artistId: string): Promise<string[]> {
  if (MOCK_MODE) {
    return mockGetArtistGenres(artistId);
  }

  const token = await getSpotifyToken();
  
  const response = await fetch(
    `https://api.spotify.com/v1/artists/${artistId}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (!response.ok) {
    return [];
  }

  const data = await response.json();
  return data.genres || [];
}
