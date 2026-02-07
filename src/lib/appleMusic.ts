// Apple Music API Integration
// Provides track search, metadata fetching, and catalog ingestion
// Pair-owned recommendation engine - no third-party dependencies

import * as jose from 'jose';

const APPLE_SEARCH_MAX_LIMIT = 25;

// Apple Music Developer Token generation
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAppleMusicDeveloperToken(): Promise<string | null> {
  // Check if we have a valid cached token
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  let privateKey = process.env.APPLE_MUSIC_PRIVATE_KEY;
  const teamId = process.env.APPLE_MUSIC_TEAM_ID;
  const keyId = process.env.APPLE_MUSIC_KEY_ID;

  if (!privateKey || !teamId || !keyId) {
    console.warn("Apple Music credentials not configured");
    return null;
  }

  // Handle different private key formats from environment variables
  // Vercel might store with literal \n or actual newlines
  if (privateKey.includes('\\n')) {
    privateKey = privateKey.replace(/\\n/g, '\n');
  }
  
  // Ensure proper PEM format
  if (!privateKey.includes('-----BEGIN')) {
    privateKey = `-----BEGIN PRIVATE KEY-----\n${privateKey}\n-----END PRIVATE KEY-----`;
  }

  try {
    // Parse the private key
    const key = await jose.importPKCS8(privateKey, 'ES256');
    
    // Create JWT token
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = 15777000; // ~6 months in seconds
    
    const token = await new jose.SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: keyId })
      .setIssuer(teamId)
      .setIssuedAt(now)
      .setExpirationTime(now + expiresIn)
      .sign(key);

    // Cache the token (expire 1 hour before actual expiry for safety)
    cachedToken = {
      token,
      expiresAt: Date.now() + (expiresIn - 3600) * 1000,
    };

    return token;
  } catch (error) {
    console.error("Error generating Apple Music token:", error);
    return null;
  }
}

export interface AppleMusicTrack {
  id: string;
  attributes: {
    name: string;
    artistName: string;
    albumName: string;
    durationInMillis: number;
    releaseDate: string;
    genreNames: string[];
    previews?: Array<{ url: string }>;
    artwork?: {
      url: string;
      width: number;
      height: number;
    };
    isrc?: string;
  };
}

export interface PairTrack {
  id?: string;
  apple_music_id: string;
  spotify_id?: string;
  isrc?: string;
  track_name: string;
  artist_name: string;
  album_name?: string;
  album_art_url?: string;
  preview_url?: string;
  duration_ms?: number;
  release_date?: string;
  energy?: number;
  valence?: number;
  danceability?: number;
  acousticness?: number;
  instrumentalness?: number;
  tempo?: number;
  loudness?: number;
  genres?: string[];
  mood_tags?: string[];
}

function canonicalizeGenreToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[\/_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildWeeklyGenreSearchQueries(preferredGenres: string[]): string[] {
  const base = (preferredGenres || [])
    .map(canonicalizeGenreToken)
    .filter(Boolean);

  const queries: string[] = [];
  const push = (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    if (!queries.includes(trimmed)) queries.push(trimmed);
  };

  for (const genre of base) {
    if (genre.includes("hip hop") || genre.includes("rap")) {
      push("new hip hop");
      push("new rap");
      continue;
    }
    if (genre.includes("rnb") || genre.includes("rhythm and blues") || genre.includes("soul")) {
      push("new rnb");
      push("new soul");
      continue;
    }
    if (genre.includes("electronic") || genre.includes("dance") || genre.includes("edm")) {
      push("new electronic");
      push("new dance");
      push("new edm");
      continue;
    }
    if (genre.includes("country") || genre.includes("folk")) {
      push("new country");
      push("new folk");
      continue;
    }
    if (genre.includes("indie") || genre.includes("alternative")) {
      push("new indie");
      push("new alternative");
      continue;
    }
    if (genre.includes("pop")) {
      push("new pop");
      continue;
    }
    if (genre.includes("rock")) {
      push("new rock");
      continue;
    }
    if (genre.includes("latin") || genre.includes("global")) {
      push("new latin");
      continue;
    }

    push(`new ${genre}`);
  }

  return queries.slice(0, 12);
}

// Mock Apple Music data for development (similar to MOCK_SPOTIFY mode)
const MOCK_APPLE_MUSIC = process.env.MOCK_APPLE_MUSIC === "true";

// Helper to get current week's Friday date for mock data
function getMockReleaseDate(): string {
  const now = new Date();
  const nyTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const dayOfWeek = nyTime.getDay();
  let daysToSubtract = (dayOfWeek - 5 + 7) % 7;
  const weekStart = new Date(nyTime);
  weekStart.setDate(nyTime.getDate() - daysToSubtract);
  return weekStart.toISOString().split('T')[0];
}

const mockAppleMusicTracks: PairTrack[] = [
  {
    apple_music_id: "1544494996",
    track_name: "Blinding Lights",
    artist_name: "The Weeknd",
    album_name: "After Hours",
    album_art_url: "https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/ab/0c/e2/ab0ce2c5-8e5c-4c5d-8c5c-8e5c4c5d8c5c/source/600x600bb.jpg",
    preview_url: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview125/v4/e3/69/c4/e369c4e3-6d5e-d4c4-8c5c-8e5c4c5d8c5c/mzaf_123456789.plus.aac.p.m4a",
    duration_ms: 200040,
    get release_date() { return getMockReleaseDate(); },
    genres: ["Pop", "R&B/Soul"],
    energy: 0.73,
    valence: 0.33,
    danceability: 0.51,
    acousticness: 0.00,
    instrumentalness: 0.00,
    tempo: 171,
  },
  {
    apple_music_id: "1440833237",
    track_name: "Bohemian Rhapsody",
    artist_name: "Queen",
    album_name: "A Night at the Opera",
    album_art_url: "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/queen.jpg",
    preview_url: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview115/v4/queen/mzaf_987654321.plus.aac.p.m4a",
    duration_ms: 354320,
    get release_date() { return getMockReleaseDate(); },
    genres: ["Rock"],
    energy: 0.40,
    valence: 0.22,
    danceability: 0.39,
    acousticness: 0.28,
    instrumentalness: 0.00,
    tempo: 72,
  },
  {
    apple_music_id: "1450695739",
    track_name: "bad guy",
    artist_name: "Billie Eilish",
    album_name: "WHEN WE ALL FALL ASLEEP, WHERE DO WE GO?",
    album_art_url: "https://is1-ssl.mzstatic.com/image/thumb/Music124/billie.jpg",
    preview_url: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview124/v4/billie/mzaf_111222333.plus.aac.p.m4a",
    duration_ms: 194088,
    get release_date() { return getMockReleaseDate(); },
    genres: ["Alternative", "Pop"],
    energy: 0.43,
    valence: 0.56,
    danceability: 0.70,
    acousticness: 0.33,
    instrumentalness: 0.13,
    tempo: 135,
  },
  {
    apple_music_id: "1468058165",
    track_name: "Watermelon Sugar",
    artist_name: "Harry Styles",
    album_name: "Fine Line",
    album_art_url: "https://is1-ssl.mzstatic.com/image/thumb/Music124/harry.jpg",
    preview_url: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview124/v4/harry/mzaf_444555666.plus.aac.p.m4a",
    duration_ms: 174000,
    get release_date() { return getMockReleaseDate(); },
    genres: ["Pop", "Rock"],
    energy: 0.82,
    valence: 0.56,
    danceability: 0.55,
    acousticness: 0.12,
    instrumentalness: 0.00,
    tempo: 95,
  },
  {
    apple_music_id: "1574210519",
    track_name: "Heat Waves",
    artist_name: "Glass Animals",
    album_name: "Dreamland",
    album_art_url: "https://is1-ssl.mzstatic.com/image/thumb/Music125/glass.jpg",
    preview_url: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview125/v4/glass/mzaf_777888999.plus.aac.p.m4a",
    duration_ms: 238805,
    get release_date() { return getMockReleaseDate(); },
    genres: ["Alternative", "Indie"],
    energy: 0.53,
    valence: 0.47,
    danceability: 0.76,
    acousticness: 0.17,
    instrumentalness: 0.00,
    tempo: 81,
  },
  {
    apple_music_id: "1556175854",
    track_name: "Levitating",
    artist_name: "Dua Lipa",
    album_name: "Future Nostalgia",
    album_art_url: "https://is1-ssl.mzstatic.com/image/thumb/Music125/dua.jpg",
    preview_url: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview125/v4/dua/mzaf_000111222.plus.aac.p.m4a",
    duration_ms: 203064,
    get release_date() { return getMockReleaseDate(); },
    genres: ["Pop", "Dance"],
    energy: 0.83,
    valence: 0.91,
    danceability: 0.70,
    acousticness: 0.01,
    instrumentalness: 0.00,
    tempo: 103,
  },
  {
    apple_music_id: "1508562362",
    track_name: "drivers license",
    artist_name: "Olivia Rodrigo",
    album_name: "SOUR",
    album_art_url: "https://is1-ssl.mzstatic.com/image/thumb/Music125/olivia.jpg",
    preview_url: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview125/v4/olivia/mzaf_333444555.plus.aac.p.m4a",
    duration_ms: 242014,
    get release_date() { return getMockReleaseDate(); },
    genres: ["Pop"],
    energy: 0.43,
    valence: 0.13,
    danceability: 0.59,
    acousticness: 0.72,
    instrumentalness: 0.00,
    tempo: 144,
  },
  {
    apple_music_id: "1440818839",
    track_name: "Stairway to Heaven",
    artist_name: "Led Zeppelin",
    album_name: "Led Zeppelin IV",
    album_art_url: "https://is1-ssl.mzstatic.com/image/thumb/Music115/zeppelin.jpg",
    preview_url: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview115/v4/zeppelin/mzaf_666777888.plus.aac.p.m4a",
    duration_ms: 482830,
    get release_date() { return getMockReleaseDate(); },
    genres: ["Rock", "Classic Rock"],
    energy: 0.34,
    valence: 0.20,
    danceability: 0.33,
    acousticness: 0.58,
    instrumentalness: 0.00,
    tempo: 82,
  },
  {
    apple_music_id: "1469577723",
    track_name: "Circles",
    artist_name: "Post Malone",
    album_name: "Hollywood's Bleeding",
    album_art_url: "https://is1-ssl.mzstatic.com/image/thumb/Music124/post.jpg",
    preview_url: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview124/v4/post/mzaf_999000111.plus.aac.p.m4a",
    duration_ms: 215280,
    get release_date() { return getMockReleaseDate(); },
    genres: ["Pop", "Hip-Hop/Rap"],
    energy: 0.51,
    valence: 0.55,
    danceability: 0.70,
    acousticness: 0.19,
    instrumentalness: 0.00,
    tempo: 120,
  },
  {
    apple_music_id: "1440857781",
    track_name: "Smells Like Teen Spirit",
    artist_name: "Nirvana",
    album_name: "Nevermind",
    album_art_url: "https://is1-ssl.mzstatic.com/image/thumb/Music115/nirvana.jpg",
    preview_url: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview115/v4/nirvana/mzaf_222333444.plus.aac.p.m4a",
    duration_ms: 301920,
    get release_date() { return getMockReleaseDate(); },
    genres: ["Rock", "Alternative"],
    energy: 0.91,
    valence: 0.26,
    danceability: 0.50,
    acousticness: 0.00,
    instrumentalness: 0.00,
    tempo: 117,
  },
  {
    apple_music_id: "1574562401",
    track_name: "Stay",
    artist_name: "The Kid LAROI & Justin Bieber",
    album_name: "F*CK LOVE 3: OVER YOU",
    album_art_url: "https://is1-ssl.mzstatic.com/image/thumb/Music125/laroi.jpg",
    preview_url: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview125/v4/laroi/mzaf_555666777.plus.aac.p.m4a",
    duration_ms: 141806,
    get release_date() { return getMockReleaseDate(); },
    genres: ["Pop", "Hip-Hop/Rap"],
    energy: 0.76,
    valence: 0.48,
    danceability: 0.59,
    acousticness: 0.04,
    instrumentalness: 0.00,
    tempo: 170,
  },
  {
    apple_music_id: "1440833098",
    track_name: "Hotel California",
    artist_name: "Eagles",
    album_name: "Hotel California",
    album_art_url: "https://is1-ssl.mzstatic.com/image/thumb/Music115/eagles.jpg",
    preview_url: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview115/v4/eagles/mzaf_888999000.plus.aac.p.m4a",
    duration_ms: 390480,
    get release_date() { return getMockReleaseDate(); },
    genres: ["Rock", "Classic Rock"],
    energy: 0.50,
    valence: 0.30,
    danceability: 0.45,
    acousticness: 0.02,
    instrumentalness: 0.00,
    tempo: 75,
  },
  {
    apple_music_id: "1560735414",
    track_name: "Peaches",
    artist_name: "Justin Bieber",
    album_name: "Justice",
    album_art_url: "https://is1-ssl.mzstatic.com/image/thumb/Music125/bieber.jpg",
    preview_url: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview125/v4/bieber/mzaf_111222333.plus.aac.p.m4a",
    duration_ms: 198082,
    get release_date() { return getMockReleaseDate(); },
    genres: ["Pop", "R&B/Soul"],
    energy: 0.68,
    valence: 0.68,
    danceability: 0.68,
    acousticness: 0.32,
    instrumentalness: 0.00,
    tempo: 90,
  },
  {
    apple_music_id: "1440857799",
    track_name: "Come As You Are",
    artist_name: "Nirvana",
    album_name: "Nevermind",
    album_art_url: "https://is1-ssl.mzstatic.com/image/thumb/Music115/nirvana2.jpg",
    preview_url: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview115/v4/nirvana2/mzaf_444555666.plus.aac.p.m4a",
    duration_ms: 219173,
    get release_date() { return getMockReleaseDate(); },
    genres: ["Rock", "Alternative"],
    energy: 0.62,
    valence: 0.24,
    danceability: 0.55,
    acousticness: 0.00,
    instrumentalness: 0.00,
    tempo: 120,
  },
  {
    apple_music_id: "1544494997",
    track_name: "Save Your Tears",
    artist_name: "The Weeknd",
    album_name: "After Hours",
    album_art_url: "https://is1-ssl.mzstatic.com/image/thumb/Music125/weeknd2.jpg",
    preview_url: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview125/v4/weeknd2/mzaf_777888999.plus.aac.p.m4a",
    duration_ms: 215627,
    get release_date() { return getMockReleaseDate(); },
    genres: ["Pop", "R&B/Soul"],
    energy: 0.83,
    valence: 0.64,
    danceability: 0.68,
    acousticness: 0.02,
    instrumentalness: 0.00,
    tempo: 118,
  },
  {
    apple_music_id: "1556175856",
    track_name: "Don't Start Now",
    artist_name: "Dua Lipa",
    album_name: "Future Nostalgia",
    album_art_url: "https://is1-ssl.mzstatic.com/image/thumb/Music125/dua2.jpg",
    preview_url: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview125/v4/dua2/mzaf_000111222.plus.aac.p.m4a",
    duration_ms: 183290,
    get release_date() { return getMockReleaseDate(); },
    genres: ["Pop", "Dance"],
    energy: 0.79,
    valence: 0.68,
    danceability: 0.79,
    acousticness: 0.01,
    instrumentalness: 0.00,
    tempo: 124,
  },
  {
    apple_music_id: "1508562364",
    track_name: "good 4 u",
    artist_name: "Olivia Rodrigo",
    album_name: "SOUR",
    album_art_url: "https://is1-ssl.mzstatic.com/image/thumb/Music125/olivia2.jpg",
    preview_url: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview125/v4/olivia2/mzaf_333444555.plus.aac.p.m4a",
    duration_ms: 178147,
    get release_date() { return getMockReleaseDate(); },
    genres: ["Pop", "Rock"],
    energy: 0.66,
    valence: 0.69,
    danceability: 0.56,
    acousticness: 0.00,
    instrumentalness: 0.00,
    tempo: 166,
  },
  {
    apple_music_id: "1574210521",
    track_name: "Space Ghost Coast to Coast",
    artist_name: "Glass Animals",
    album_name: "Dreamland",
    album_art_url: "https://is1-ssl.mzstatic.com/image/thumb/Music125/glass2.jpg",
    preview_url: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview125/v4/glass2/mzaf_666777888.plus.aac.p.m4a",
    duration_ms: 232000,
    get release_date() { return getMockReleaseDate(); },
    genres: ["Alternative", "Indie"],
    energy: 0.61,
    valence: 0.52,
    danceability: 0.72,
    acousticness: 0.08,
    instrumentalness: 0.00,
    tempo: 92,
  },
  {
    apple_music_id: "1469577725",
    track_name: "Sunflower",
    artist_name: "Post Malone & Swae Lee",
    album_name: "Spider-Man: Into the Spider-Verse",
    album_art_url: "https://is1-ssl.mzstatic.com/image/thumb/Music124/sunflower.jpg",
    preview_url: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview124/v4/sunflower/mzaf_999000111.plus.aac.p.m4a",
    duration_ms: 158040,
    get release_date() { return getMockReleaseDate(); },
    genres: ["Pop", "Hip-Hop/Rap"],
    energy: 0.48,
    valence: 0.91,
    danceability: 0.76,
    acousticness: 0.56,
    instrumentalness: 0.00,
    tempo: 90,
  },
  {
    apple_music_id: "1468058167",
    track_name: "Adore You",
    artist_name: "Harry Styles",
    album_name: "Fine Line",
    album_art_url: "https://is1-ssl.mzstatic.com/image/thumb/Music124/harry2.jpg",
    preview_url: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview124/v4/harry2/mzaf_222333444.plus.aac.p.m4a",
    duration_ms: 207133,
    get release_date() { return getMockReleaseDate(); },
    genres: ["Pop", "Rock"],
    energy: 0.81,
    valence: 0.75,
    danceability: 0.66,
    acousticness: 0.24,
    instrumentalness: 0.00,
    tempo: 99,
  },
];

export async function searchAppleMusicTracks(query: string, limit: number = 20): Promise<PairTrack[]> {
  const safeLimit = Math.max(1, Math.min(limit, APPLE_SEARCH_MAX_LIMIT));

  if (MOCK_APPLE_MUSIC) {
    const lowerQuery = query.toLowerCase();
    return mockAppleMusicTracks.filter(
      (track) =>
        track.track_name.toLowerCase().includes(lowerQuery) ||
        track.artist_name.toLowerCase().includes(lowerQuery)
    ).slice(0, safeLimit);
  }

  // Get developer token (generated dynamically from private key)
  const developerToken = await getAppleMusicDeveloperToken();
  if (!developerToken) {
    console.error("Apple Music API token not available - check APPLE_MUSIC_PRIVATE_KEY, APPLE_MUSIC_TEAM_ID, APPLE_MUSIC_KEY_ID env vars");
    return [];
  }

  try {
    const searchUrl = `https://api.music.apple.com/v1/catalog/us/search?term=${encodeURIComponent(query)}&types=songs&limit=${safeLimit}`;
    console.log(`Apple Music search URL: ${searchUrl}`);
    
    const response = await fetch(
      searchUrl,
      {
        headers: {
          Authorization: `Bearer ${developerToken}`,
        },
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`Apple Music API error response: ${errorBody}`);
      throw new Error(`Apple Music API error: ${response.status} - ${errorBody}`);
    }

    const data = await response.json();
    const songs = data.results?.songs?.data || [];

    return songs.map((song: AppleMusicTrack) => ({
      apple_music_id: song.id,
      track_name: song.attributes.name,
      artist_name: song.attributes.artistName,
      album_name: song.attributes.albumName,
      album_art_url: song.attributes.artwork?.url
        .replace("{w}", "600")
        .replace("{h}", "600"),
      preview_url: song.attributes.previews?.[0]?.url,
      duration_ms: song.attributes.durationInMillis,
      release_date: song.attributes.releaseDate,
      genres: song.attributes.genreNames,
      isrc: song.attributes.isrc,
    }));
  } catch (error) {
    console.error("Apple Music search error:", error);
    return []; // Return empty array instead of mock data
  }
}

export async function getAppleMusicTrack(appleMusicId: string): Promise<PairTrack | null> {
  if (MOCK_APPLE_MUSIC) {
    return mockAppleMusicTracks.find((t) => t.apple_music_id === appleMusicId) || null;
  }

  const developerToken = await getAppleMusicDeveloperToken();
  if (!developerToken) {
    return mockAppleMusicTracks.find((t) => t.apple_music_id === appleMusicId) || null;
  }

  try {
    const response = await fetch(
      `https://api.music.apple.com/v1/catalog/us/songs/${appleMusicId}`,
      {
        headers: {
          Authorization: `Bearer ${developerToken}`,
        },
      }
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const song = data.data?.[0];

    if (!song) return null;

    return {
      apple_music_id: song.id,
      track_name: song.attributes.name,
      artist_name: song.attributes.artistName,
      album_name: song.attributes.albumName,
      album_art_url: song.attributes.artwork?.url
        .replace("{w}", "600")
        .replace("{h}", "600"),
      preview_url: song.attributes.previews?.[0]?.url,
      duration_ms: song.attributes.durationInMillis,
      release_date: song.attributes.releaseDate,
      genres: song.attributes.genreNames,
      isrc: song.attributes.isrc,
    };
  } catch (error) {
    console.error("Apple Music get track error:", error);
    return null;
  }
}

export function getMockCandidates(excludeIds: string[] = []): PairTrack[] {
  return mockAppleMusicTracks.filter((t) => !excludeIds.includes(t.apple_music_id));
}

// Search for playlists containing an artist and extract tracks (playlist co-occurrence)
// This is the KEY signal for finding similar tracks - songs curated together are likely similar
async function getPlaylistCooccurrenceTracks(artistName: string, seedTrackName: string): Promise<PairTrack[]> {
  const developerToken = await getAppleMusicDeveloperToken();
  if (!developerToken) return [];

  const tracks: PairTrack[] = [];
  const seenIds = new Set<string>();

  try {
    // Search for playlists featuring this artist
    const playlistQueries = [
      `${artistName} playlist`,
      `${artistName} mix`,
      `${artistName} essentials`,
      `similar to ${artistName}`,
    ];

    for (const query of playlistQueries) {
      if (tracks.length >= 50) break;
      
      const response = await fetch(
        `https://api.music.apple.com/v1/catalog/us/search?term=${encodeURIComponent(query)}&types=playlists&limit=5`,
        { headers: { Authorization: `Bearer ${developerToken}` } }
      );
      
      if (!response.ok) continue;
      const data = await response.json();
      const playlists = data.results?.playlists?.data || [];
      
      // Get tracks from each playlist
      for (const playlist of playlists) {
        if (tracks.length >= 50) break;
        
        try {
          const tracksResponse = await fetch(
            `https://api.music.apple.com/v1/catalog/us/playlists/${playlist.id}/tracks?limit=25`,
            { headers: { Authorization: `Bearer ${developerToken}` } }
          );
          
          if (!tracksResponse.ok) continue;
          const tracksData = await tracksResponse.json();
          
          for (const song of tracksData.data || []) {
            if (seenIds.has(song.id)) continue;
            // Skip the seed track itself
            if (song.attributes.name.toLowerCase() === seedTrackName.toLowerCase()) continue;
            
            seenIds.add(song.id);
            tracks.push({
              apple_music_id: song.id,
              track_name: song.attributes.name,
              artist_name: song.attributes.artistName,
              album_name: song.attributes.albumName,
              album_art_url: song.attributes.artwork?.url?.replace("{w}", "600").replace("{h}", "600"),
              preview_url: song.attributes.previews?.[0]?.url,
              duration_ms: song.attributes.durationInMillis,
              release_date: song.attributes.releaseDate,
              genres: song.attributes.genreNames,
              // Mark as playlist co-occurrence for scoring boost
              _source: 'playlist_cooccurrence',
            } as PairTrack);
          }
        } catch {
          continue;
        }
      }
    }
    
    console.log(`Found ${tracks.length} tracks from playlist co-occurrence for ${artistName}`);
    return tracks;
  } catch (error) {
    console.error("Error getting playlist co-occurrence tracks:", error);
    return [];
  }
}

// Get similar artists by searching for "artists like X" or known similar artists
async function getSimilarArtistTracks(artistName: string, genres: string[] = []): Promise<PairTrack[]> {
  const developerToken = await getAppleMusicDeveloperToken();
  if (!developerToken) return [];

  const tracks: PairTrack[] = [];
  const seenIds = new Set<string>();

  try {
    // Search queries to find similar artists
    const queries = [
      `artists like ${artistName}`,
      `similar to ${artistName}`,
      `${artistName} style`,
    ];
    
    // Add genre-specific queries if we have genres
    if (genres.length > 0) {
      const primaryGenre = genres[0];
      queries.push(`best ${primaryGenre} artists`);
      queries.push(`${primaryGenre} producers`);
    }

    for (const query of queries) {
      if (tracks.length >= 30) break;
      
      const response = await fetch(
        `https://api.music.apple.com/v1/catalog/us/search?term=${encodeURIComponent(query)}&types=songs&limit=15`,
        { headers: { Authorization: `Bearer ${developerToken}` } }
      );
      
      if (!response.ok) continue;
      const data = await response.json();
      const songs = data.results?.songs?.data || [];
      
      for (const song of songs) {
        if (seenIds.has(song.id)) continue;
        // Skip tracks from the same artist (we get those separately)
        if (song.attributes.artistName.toLowerCase() === artistName.toLowerCase()) continue;
        
        seenIds.add(song.id);
        tracks.push({
          apple_music_id: song.id,
          track_name: song.attributes.name,
          artist_name: song.attributes.artistName,
          album_name: song.attributes.albumName,
          album_art_url: song.attributes.artwork?.url?.replace("{w}", "600").replace("{h}", "600"),
          preview_url: song.attributes.previews?.[0]?.url,
          duration_ms: song.attributes.durationInMillis,
          release_date: song.attributes.releaseDate,
          genres: song.attributes.genreNames,
        });
      }
    }
    
    console.log(`Found ${tracks.length} tracks from similar artist search for ${artistName}`);
    return tracks;
  } catch (error) {
    console.error("Error getting similar artist tracks:", error);
    return [];
  }
}

// Get artist info from Apple Music (for related artists)
async function getAppleMusicArtist(artistName: string): Promise<{ id: string; name: string } | null> {
  const developerToken = await getAppleMusicDeveloperToken();
  if (!developerToken) return null;

  try {
    const response = await fetch(
      `https://api.music.apple.com/v1/catalog/us/search?term=${encodeURIComponent(artistName)}&types=artists&limit=1`,
      { headers: { Authorization: `Bearer ${developerToken}` } }
    );
    if (!response.ok) return null;
    const data = await response.json();
    const artist = data.results?.artists?.data?.[0];
    return artist ? { id: artist.id, name: artist.attributes.name } : null;
  } catch {
    return null;
  }
}

// Get related artists from Apple Music
async function getRelatedArtists(artistId: string): Promise<string[]> {
  const developerToken = await getAppleMusicDeveloperToken();
  if (!developerToken) return [];

  try {
    // Apple Music doesn't have a direct "related artists" endpoint, but we can use:
    // 1. Artist's albums -> other artists on those albums (collaborators)
    // 2. Search for similar genre artists
    const response = await fetch(
      `https://api.music.apple.com/v1/catalog/us/artists/${artistId}/albums?limit=10`,
      { headers: { Authorization: `Bearer ${developerToken}` } }
    );
    if (!response.ok) return [];
    const data = await response.json();
    
    const relatedArtists = new Set<string>();
    for (const album of data.data || []) {
      const artistName = album.attributes?.artistName;
      if (artistName && !artistName.includes('&') && !artistName.includes(',')) {
        relatedArtists.add(artistName);
      }
    }
    return Array.from(relatedArtists).slice(0, 5);
  } catch {
    return [];
  }
}

// Get tracks from an artist's albums (including deep cuts, not just top tracks)
async function getArtistDeepCuts(artistId: string, limit: number = 20): Promise<PairTrack[]> {
  const developerToken = await getAppleMusicDeveloperToken();
  if (!developerToken) return [];

  try {
    // Get artist's albums
    const albumsResponse = await fetch(
      `https://api.music.apple.com/v1/catalog/us/artists/${artistId}/albums?limit=5`,
      { headers: { Authorization: `Bearer ${developerToken}` } }
    );
    if (!albumsResponse.ok) return [];
    const albumsData = await albumsResponse.json();
    
    const tracks: PairTrack[] = [];
    for (const album of albumsData.data || []) {
      if (tracks.length >= limit) break;
      
      // Get tracks from each album
      const tracksResponse = await fetch(
        `https://api.music.apple.com/v1/catalog/us/albums/${album.id}/tracks?limit=10`,
        { headers: { Authorization: `Bearer ${developerToken}` } }
      );
      if (!tracksResponse.ok) continue;
      const tracksData = await tracksResponse.json();
      
      for (const song of tracksData.data || []) {
        if (tracks.length >= limit) break;
        tracks.push({
          apple_music_id: song.id,
          track_name: song.attributes.name,
          artist_name: song.attributes.artistName,
          album_name: song.attributes.albumName,
          album_art_url: song.attributes.artwork?.url?.replace("{w}", "600").replace("{h}", "600"),
          preview_url: song.attributes.previews?.[0]?.url,
          duration_ms: song.attributes.durationInMillis,
          release_date: song.attributes.releaseDate,
          genres: song.attributes.genreNames,
        });
      }
    }
    return tracks;
  } catch {
    return [];
  }
}

// Search for tracks by genre with more specificity
async function searchByGenreAndEra(genre: string, releaseYear?: string, limit: number = 15): Promise<PairTrack[]> {
  const searchQuery = releaseYear ? `${genre} ${releaseYear}` : genre;
  return searchAppleMusicTracks(searchQuery, limit);
}

// Get related tracks from Apple Music based on seed track
// Pair-owned candidate generation - no third-party dependencies
export async function getAppleMusicRelatedTracks(
  seedTrack: PairTrack,
  excludeIds: string[] = [],
  limit: number = 25
): Promise<PairTrack[]> {
  if (MOCK_APPLE_MUSIC) {
    console.log("MOCK_APPLE_MUSIC is enabled, returning mock data");
    return mockAppleMusicTracks.filter((t) => !excludeIds.includes(t.apple_music_id)).slice(0, limit);
  }

  const developerToken = await getAppleMusicDeveloperToken();
  if (!developerToken) {
    console.error("No Apple Music developer token available - check APPLE_MUSIC_PRIVATE_KEY, APPLE_MUSIC_TEAM_ID, APPLE_MUSIC_KEY_ID env vars");
    return [];
  }

  const candidates: PairTrack[] = [];
  const seenIds = new Set(excludeIds);
  const seenArtists = new Set<string>();
  
  // Add seed track to exclusions
  seenIds.add(seedTrack.apple_music_id);
  seenArtists.add(seedTrack.artist_name.toLowerCase());

  const addCandidate = (track: PairTrack): boolean => {
    if (seenIds.has(track.apple_music_id)) return false;
    candidates.push(track);
    seenIds.add(track.apple_music_id);
    seenArtists.add(track.artist_name.toLowerCase());
    return true;
  };

  try {
    console.log(`\n========================================`);
    console.log(`2-STAGE PIPELINE: Generating candidates for: ${seedTrack.track_name} by ${seedTrack.artist_name}`);
    console.log(`========================================\n`);
    
    // ============================================================================
    // STAGE 1: CANDIDATE GENERATION FROM APPLE'S GRAPH
    // Priority order: Playlist co-occurrence > Same artist > Similar artists
    // ============================================================================
    
    // STRATEGY 1 (HIGHEST PRIORITY): Playlist co-occurrence
    // Songs that appear alongside the seed in curated playlists are the BEST signal
    console.log(`STRATEGY 1: Playlist co-occurrence (highest priority)...`);
    const playlistTracks = await getPlaylistCooccurrenceTracks(seedTrack.artist_name, seedTrack.track_name);
    for (const track of playlistTracks) {
      addCandidate(track);
    }
    console.log(`  Added ${candidates.length} tracks from playlist co-occurrence`);

    // STRATEGY 2: Same artist's other tracks
    // Tracks from the same artist have similar production style
    console.log(`STRATEGY 2: Same artist tracks...`);
    const seedArtist = await getAppleMusicArtist(seedTrack.artist_name);
    if (seedArtist) {
      const deepCuts = await getArtistDeepCuts(seedArtist.id, 20);
      let sameArtistCount = 0;
      for (const track of deepCuts) {
        if (sameArtistCount >= 8) break; // Max 8 from same artist
        if (addCandidate(track)) sameArtistCount++;
      }
      console.log(`  Added ${sameArtistCount} tracks from same artist, total: ${candidates.length}`);
    }

    // STRATEGY 3: Similar artists from search
    // Find tracks from artists similar to the seed artist
    console.log(`STRATEGY 3: Similar artist tracks...`);
    const similarTracks = await getSimilarArtistTracks(seedTrack.artist_name, seedTrack.genres);
    for (const track of similarTracks) {
      if (!seenArtists.has(track.artist_name.toLowerCase())) {
        addCandidate(track);
      }
    }
    console.log(`  Added similar artist tracks, total: ${candidates.length}`);

    // STRATEGY 4: Related/collaborating artists from albums
    if (seedArtist && candidates.length < 50) {
      console.log(`STRATEGY 4: Collaborating artists...`);
      const relatedArtists = await getRelatedArtists(seedArtist.id);
      for (const artistName of relatedArtists) {
        if (candidates.length >= 60) break;
        const artistTracks = await searchAppleMusicTracks(artistName, 10);
        for (const track of artistTracks) {
          if (candidates.length >= 60) break;
          if (!seenArtists.has(track.artist_name.toLowerCase())) {
            addCandidate(track);
          }
        }
      }
      console.log(`  Added collaborating artist tracks, total: ${candidates.length}`);
    }

    // STRATEGY 5: Genre-specific search (only if we need more candidates)
    if (candidates.length < 40 && seedTrack.genres && seedTrack.genres.length > 0) {
      console.log(`STRATEGY 5: Genre-specific search...`);
      // Use specific genre terms, not generic "music"
      const genreQueries = seedTrack.genres.slice(0, 3).map(g => 
        g.toLowerCase().replace('music', '').trim()
      ).filter(g => g.length > 2);
      
      for (const genre of genreQueries) {
        if (candidates.length >= 60) break;
        const genreTracks = await searchAppleMusicTracks(`${genre} songs`, 15);
        for (const track of genreTracks) {
          if (candidates.length >= 60) break;
          if (!seenArtists.has(track.artist_name.toLowerCase())) {
            addCandidate(track);
          }
        }
      }
      console.log(`  Added genre tracks, total: ${candidates.length}`);
    }

    console.log(`\nFinal candidate count: ${candidates.length}`);
    console.log(`========================================\n`);
    return candidates.slice(0, limit);
  } catch (error) {
    console.error("Error getting related tracks:", error);
    console.log(`Returning ${candidates.length} candidates after error`);
    return candidates.slice(0, limit);
  }
}

// ============================================================================
// NEW RELEASES FETCHER - Core function for Pair's weekly discovery
// Fetches tracks released THIS WEEK from Apple Music
// ============================================================================

/**
 * Get the weekly window for new releases
 * Phoenix timezone: Thursday 10:00 PM to next Thursday 9:59 PM
 * This corresponds to Friday 5:00 AM UTC to next Friday 4:59 AM UTC
 * 
 * Returns { start: Date, end: Date } for the current weekly window
 */
function getWeeklyWindow(): { start: Date; end: Date; weekId: string } {
  const now = new Date();
  
  // Convert to Phoenix timezone (America/Phoenix = UTC-7, no DST)
  const phoenixOffset = -7 * 60; // -7 hours in minutes
  const phoenixTime = new Date(now.getTime() + (now.getTimezoneOffset() + phoenixOffset) * 60000);
  
  // Find the most recent Thursday 10pm Phoenix
  const dayOfWeek = phoenixTime.getDay(); // 0 = Sunday, 4 = Thursday
  const hour = phoenixTime.getHours();
  
  // Calculate days since last Thursday 10pm
  let daysToSubtract = (dayOfWeek - 4 + 7) % 7;
  
  // If it's Thursday but before 10pm, go back to previous Thursday
  if (dayOfWeek === 4 && hour < 22) {
    daysToSubtract = 7;
  }
  
  // Calculate window start (Thursday 10pm Phoenix = Friday 5am UTC)
  const windowStart = new Date(phoenixTime);
  windowStart.setDate(phoenixTime.getDate() - daysToSubtract);
  windowStart.setHours(22, 0, 0, 0);
  
  // Convert back to UTC
  const startUTC = new Date(windowStart.getTime() - (now.getTimezoneOffset() + phoenixOffset) * 60000);
  
  // Window end is 7 days later
  const endUTC = new Date(startUTC.getTime() + 7 * 24 * 60 * 60 * 1000);
  
  // Week ID is the Friday date in Phoenix local date (not UTC-shifted).
  const fridayDatePhoenix = new Date(windowStart);
  fridayDatePhoenix.setDate(windowStart.getDate() + 1); // Thursday 10pm -> Friday date
  const year = fridayDatePhoenix.getFullYear();
  const month = String(fridayDatePhoenix.getMonth() + 1).padStart(2, "0");
  const day = String(fridayDatePhoenix.getDate()).padStart(2, "0");
  const weekId = `${year}-${month}-${day}`;
  
  return { start: startUTC, end: endUTC, weekId };
}

/**
 * Check if a release date falls within the current weekly window
 * STRICT: Only returns true if release_date is within this week's window
 */
function isWithinWeeklyWindow(releaseDate: string | undefined): boolean {
  if (!releaseDate) return false;
  
  // Apple Music release dates are day-only strings (YYYY-MM-DD).
  // Compare by local Friday-date window to avoid UTC hour cutoff dropping Friday releases.
  const { weekId } = getWeeklyWindow(); // Friday date string for current week in Phoenix
  const weekStart = new Date(`${weekId}T00:00:00Z`);
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
  const release = new Date(`${releaseDate}T00:00:00Z`);
  return release >= weekStart && release < weekEnd;
}

/**
 * Get the current week's start date (Friday)
 * Used for display purposes and week identification
 */
function getWeekStartDate(): Date {
  const { start } = getWeeklyWindow();
  return start;
}

/**
 * Fetch NEW RELEASES from Apple Music for the current weekly window
 * STRICT: Only returns tracks with release_date within this week's window
 * 
 * Weekly window: Thursday 10pm Phoenix to next Thursday 9:59pm Phoenix
 * If no tracks pass the filter, returns empty array (do NOT backfill old tracks)
 */
export async function getAppleMusicNewReleases(limit: number = 100, preferredGenres: string[] = []): Promise<PairTrack[]> {
  if (MOCK_APPLE_MUSIC) {
    console.log("[New Releases] MOCK mode - returning mock tracks as new releases");
    return mockAppleMusicTracks.slice(0, limit);
  }

  const developerToken = await getAppleMusicDeveloperToken();
  if (!developerToken) {
    console.error("[New Releases] No Apple Music token available - cannot fetch new releases");
    return [];
  }

  const candidates: PairTrack[] = [];
  const seenIds = new Set<string>();
  const { start, end, weekId } = getWeeklyWindow();
  
  console.log(`[New Releases] Weekly window: ${start.toISOString()} to ${end.toISOString()}`);
  console.log(`[New Releases] Week ID: ${weekId}`);

  // Helper to convert Apple Music song to PairTrack
  const songToPairTrack = (song: any): PairTrack => ({
    apple_music_id: song.id,
    track_name: song.attributes.name,
    artist_name: song.attributes.artistName,
    album_name: song.attributes.albumName,
    album_art_url: song.attributes.artwork?.url
      ?.replace("{w}", "600")
      ?.replace("{h}", "600"),
    preview_url: song.attributes.previews?.[0]?.url,
    duration_ms: song.attributes.durationInMillis,
    release_date: song.attributes.releaseDate,
    genres: song.attributes.genreNames,
    isrc: song.attributes.isrc,
  });

  // STRICT: Only accept tracks released within this week's window
  const addCandidate = (track: PairTrack): boolean => {
    if (seenIds.has(track.apple_music_id)) return false;
    
    // STRICT DATE CHECK: Must have release_date within weekly window
    if (!isWithinWeeklyWindow(track.release_date)) {
      return false;
    }
    
    candidates.push(track);
    seenIds.add(track.apple_music_id);
    return true;
  };

  let totalFetched = 0;
  let passedFilter = 0;

  try {
    // STRATEGY 1: Fetch from Apple Music charts (most reliable source)
    console.log(`[New Releases] Fetching from charts...`);
    const chartsUrl = `https://api.music.apple.com/v1/catalog/us/charts?types=songs&limit=100`;
    
    const chartsResponse = await fetch(chartsUrl, {
      headers: { Authorization: `Bearer ${developerToken}` }
    });
    
    if (chartsResponse.ok) {
      const chartsData = await chartsResponse.json();
      const chartSongs = chartsData.results?.songs?.[0]?.data || [];
      totalFetched += chartSongs.length;
      
      for (const song of chartSongs) {
        const track = songToPairTrack(song);
        if (addCandidate(track)) passedFilter++;
      }
      console.log(`[New Releases] Charts: ${chartSongs.length} fetched, ${passedFilter} passed date filter`);
    }

    // STRATEGY 2: Fetch new albums and their tracks
    console.log(`[New Releases] Fetching new albums...`);
    const albumChartsUrl = `https://api.music.apple.com/v1/catalog/us/charts?types=albums&limit=50`;
    
    const albumChartsResponse = await fetch(albumChartsUrl, {
      headers: { Authorization: `Bearer ${developerToken}` }
    });
    
    if (albumChartsResponse.ok) {
      const albumData = await albumChartsResponse.json();
      const chartAlbums = albumData.results?.albums?.[0]?.data || [];
      
      for (const album of chartAlbums.slice(0, 20)) {
        if (candidates.length >= limit) break;
        
        // Check album release date first
        const albumReleaseDate = album.attributes?.releaseDate;
        if (!isWithinWeeklyWindow(albumReleaseDate)) continue;
        
        // Fetch album tracks
        try {
          const albumTracksUrl = `https://api.music.apple.com/v1/catalog/us/albums/${album.id}/tracks?limit=20`;
          const tracksResponse = await fetch(albumTracksUrl, {
            headers: { Authorization: `Bearer ${developerToken}` }
          });
          
          if (tracksResponse.ok) {
            const tracksData = await tracksResponse.json();
            const tracks = tracksData.data || [];
            totalFetched += tracks.length;
            
            for (const song of tracks) {
              const track = songToPairTrack(song);
              // Use album release date if track doesn't have one
              if (!track.release_date) {
                track.release_date = albumReleaseDate;
              }
              if (addCandidate(track)) passedFilter++;
            }
          }
        } catch (e) {
          console.error(`[New Releases] Error fetching album tracks:`, e);
        }
      }
    }

    // STRATEGY 3: Search for recent releases (supplementary)
    if (candidates.length < limit / 2) {
      const currentYear = new Date().getFullYear();
      const searchQueries = [
        `new music ${currentYear}`,
        `new release ${currentYear}`,
        `new single ${currentYear}`,
      ];
      
      for (const query of searchQueries) {
        if (candidates.length >= limit) break;
        
        console.log(`[New Releases] Searching: "${query}"`);
        const results = await searchAppleMusicTracks(query, 25);
        totalFetched += results.length;
        
        for (const track of results) {
          if (addCandidate(track)) passedFilter++;
        }
      }
    }

    // STRATEGY 4: Genre-seeded searches from user preferences
    // This improves coverage for each selected genre (e.g. Electronic, Country).
    const genreQueries = buildWeeklyGenreSearchQueries(preferredGenres);
    if (genreQueries.length > 0 && candidates.length < limit) {
      console.log(`[New Releases] Genre-seeded search queries: ${genreQueries.join(" | ")}`);
      for (const query of genreQueries) {
        if (candidates.length >= limit) break;
        console.log(`[New Releases] Genre search: "${query}"`);
        const results = await searchAppleMusicTracks(query, 25);
        totalFetched += results.length;
        for (const track of results) {
          if (addCandidate(track)) passedFilter++;
        }
      }
    }

    console.log(`[New Releases] SUMMARY: ${totalFetched} total fetched, ${passedFilter} passed strict date filter`);
    console.log(`[New Releases] Returning ${candidates.length} tracks for week ${weekId}`);
    
    // IMPORTANT: If no tracks pass the filter, return empty array
    // Do NOT backfill with old tracks - this is the core Pair principle
    return candidates;

  } catch (error) {
    console.error("[New Releases] Error fetching new releases:", error);
    return candidates;
  }
}

/**
 * Build user's taste fingerprint from their listening history
 * Returns: top artists, preferred vibes, genre weights
 */
export interface TasteFingerprint {
  topArtists: Array<{ name: string; weight: number }>;
  preferredVibes: {
    energy: { min: number; max: number; avg: number };
    tempo: { min: number; max: number; avg: number };
    valence: { min: number; max: number; avg: number };
    danceability: { min: number; max: number; avg: number };
    acousticness: { min: number; max: number; avg: number };
  };
  genreWeights: Record<string, number>;
  doNotServe: {
    artists: string[];
    trackIds: string[];
  };
}

export function buildTasteFingerprint(
  savedTracks: PairTrack[],
  recentlyPlayed: PairTrack[],
  dislikedTracks: PairTrack[] = []
): TasteFingerprint {
  // Combine saved (strong signal) and recently played (medium signal)
  const allTracks = [
    ...savedTracks.map(t => ({ ...t, weight: 1.0 })),
    ...recentlyPlayed.map(t => ({ ...t, weight: 0.6 }))
  ];

  // Count artist occurrences with weights
  const artistCounts: Record<string, number> = {};
  for (const track of allTracks) {
    const artist = track.artist_name.toLowerCase();
    artistCounts[artist] = (artistCounts[artist] || 0) + (track as any).weight;
  }

  // Sort artists by weight
  const topArtists = Object.entries(artistCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([name, weight]) => ({ name, weight }));

  // Calculate vibe ranges
  const energies = allTracks.map(t => t.energy).filter(e => e !== undefined) as number[];
  const tempos = allTracks.map(t => t.tempo).filter(t => t !== undefined) as number[];
  const valences = allTracks.map(t => t.valence).filter(v => v !== undefined) as number[];
  const danceabilities = allTracks.map(t => t.danceability).filter(d => d !== undefined) as number[];
  const acousticnesses = allTracks.map(t => t.acousticness).filter(a => a !== undefined) as number[];

  const calcRange = (arr: number[]) => ({
    min: arr.length > 0 ? Math.min(...arr) : 0,
    max: arr.length > 0 ? Math.max(...arr) : 1,
    avg: arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0.5
  });

  // Count genre occurrences
  const genreCounts: Record<string, number> = {};
  for (const track of allTracks) {
    for (const genre of track.genres || []) {
      const normalizedGenre = genre.toLowerCase();
      genreCounts[normalizedGenre] = (genreCounts[normalizedGenre] || 0) + (track as any).weight;
    }
  }

  // Normalize genre weights
  const maxGenreCount = Math.max(...Object.values(genreCounts), 1);
  const genreWeights: Record<string, number> = {};
  for (const [genre, count] of Object.entries(genreCounts)) {
    genreWeights[genre] = count / maxGenreCount;
  }

  // Build do-not-serve list from disliked tracks
  const doNotServe = {
    artists: [...new Set(dislikedTracks.map(t => t.artist_name.toLowerCase()))],
    trackIds: dislikedTracks.map(t => t.apple_music_id)
  };

  return {
    topArtists,
    preferredVibes: {
      energy: calcRange(energies),
      tempo: calcRange(tempos),
      valence: calcRange(valences),
      danceability: calcRange(danceabilities),
      acousticness: calcRange(acousticnesses)
    },
    genreWeights,
    doNotServe
  };
}

/**
 * Score a new release candidate against user's taste fingerprint
 * Returns a score from 0-1 with breakdown
 */
export interface CandidateScore {
  total: number;
  artistProximity: number;
  vibeMatch: number;
  genreFit: number;
  novelty: number;
  reason: string;
}

export function scoreNewReleaseCandidate(
  track: PairTrack,
  fingerprint: TasteFingerprint
): CandidateScore {
  // 1. ARTIST PROXIMITY (0.35 weight)
  // Same artist = 1.0, collaborator/similar = 0.5-0.8, unknown = 0.2
  let artistProximity = 0.2; // Base score for unknown artists
  const trackArtist = track.artist_name.toLowerCase();
  
  // Check if it's a top artist
  const artistMatch = fingerprint.topArtists.find(a => 
    trackArtist.includes(a.name) || a.name.includes(trackArtist)
  );
  if (artistMatch) {
    artistProximity = 0.7 + (artistMatch.weight / fingerprint.topArtists[0]?.weight || 1) * 0.3;
  }
  
  // Check for featuring/collaboration with top artists
  for (const topArtist of fingerprint.topArtists.slice(0, 10)) {
    if (trackArtist.includes(topArtist.name) || 
        track.track_name.toLowerCase().includes(topArtist.name)) {
      artistProximity = Math.max(artistProximity, 0.6);
    }
  }

  // 2. VIBE MATCH (0.30 weight)
  // How well does the track's audio features match user's preferred ranges
  let vibeMatch = 0.5; // Default
  let vibeFactors = 0;
  
  const vibes = fingerprint.preferredVibes;
  
  if (track.energy !== undefined) {
    const energyDist = Math.abs(track.energy - vibes.energy.avg);
    const energyRange = vibes.energy.max - vibes.energy.min || 0.5;
    vibeMatch += (1 - energyDist / energyRange) * 0.25;
    vibeFactors++;
  }
  
  if (track.tempo !== undefined) {
    const tempoDist = Math.abs(track.tempo - vibes.tempo.avg);
    const tempoRange = vibes.tempo.max - vibes.tempo.min || 50;
    vibeMatch += (1 - Math.min(tempoDist / tempoRange, 1)) * 0.2;
    vibeFactors++;
  }
  
  if (track.valence !== undefined) {
    const valenceDist = Math.abs(track.valence - vibes.valence.avg);
    const valenceRange = vibes.valence.max - vibes.valence.min || 0.5;
    vibeMatch += (1 - valenceDist / valenceRange) * 0.2;
    vibeFactors++;
  }
  
  if (track.danceability !== undefined) {
    const danceDist = Math.abs(track.danceability - vibes.danceability.avg);
    const danceRange = vibes.danceability.max - vibes.danceability.min || 0.5;
    vibeMatch += (1 - danceDist / danceRange) * 0.2;
    vibeFactors++;
  }
  
  if (vibeFactors > 0) {
    vibeMatch = Math.min(vibeMatch, 1);
  }

  // 3. GENRE FIT (0.20 weight)
  // How well do the track's genres match user's preferred genres
  let genreFit = 0.3; // Base score
  const trackGenres = (track.genres || []).map(g => g.toLowerCase());
  
  for (const genre of trackGenres) {
    // Check for exact or partial genre matches
    for (const [userGenre, weight] of Object.entries(fingerprint.genreWeights)) {
      if (genre.includes(userGenre) || userGenre.includes(genre)) {
        genreFit = Math.max(genreFit, 0.3 + weight * 0.7);
      }
    }
  }

  // 4. NOVELTY SCORE (0.15 weight)
  // Penalize ultra-mainstream unless user loves mainstream
  // Boost genuinely new/emerging artists
  let novelty = 0.5;
  
  // If artist is in top 3, slightly lower novelty (they already know this artist)
  if (fingerprint.topArtists.slice(0, 3).some(a => trackArtist.includes(a.name))) {
    novelty = 0.4; // Still good, but not "discovery"
  }
  
  // If artist is completely unknown, boost novelty
  if (!artistMatch && artistProximity <= 0.3) {
    novelty = 0.7; // True discovery potential
  }

  // Calculate total score with weights
  const total = 
    artistProximity * 0.35 +
    vibeMatch * 0.30 +
    genreFit * 0.20 +
    novelty * 0.15;

  // Generate explanation
  let reason = '';
  const maxScore = Math.max(artistProximity, vibeMatch, genreFit, novelty);
  
  if (artistProximity === maxScore && artistProximity > 0.5) {
    if (artistMatch) {
      reason = `New release from ${track.artist_name}, one of your favorites`;
    } else {
      reason = `Features artists in your rotation`;
    }
  } else if (vibeMatch === maxScore && vibeMatch > 0.5) {
    reason = `Matches your preferred sound profile`;
  } else if (genreFit === maxScore && genreFit > 0.5) {
    const matchedGenre = trackGenres[0] || 'your taste';
    reason = `Fresh ${matchedGenre} that fits your style`;
  } else if (novelty === maxScore) {
    reason = `Discovery pick - new artist worth checking out`;
  } else {
    reason = `Curated for your taste profile`;
  }

  return {
    total,
    artistProximity,
    vibeMatch,
    genreFit,
    novelty,
    reason
  };
}

export { mockAppleMusicTracks };
