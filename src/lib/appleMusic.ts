// Apple Music API Integration
// Provides track search, metadata fetching, and catalog ingestion

import * as jose from 'jose';

// Apple Music Developer Token generation
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAppleMusicDeveloperToken(): Promise<string | null> {
  // Check if we have a valid cached token
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  const privateKey = process.env.APPLE_MUSIC_PRIVATE_KEY;
  const teamId = process.env.APPLE_MUSIC_TEAM_ID;
  const keyId = process.env.APPLE_MUSIC_KEY_ID;

  if (!privateKey || !teamId || !keyId) {
    console.warn("Apple Music credentials not configured");
    return null;
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

// Mock Apple Music data for development (similar to MOCK_SPOTIFY mode)
const MOCK_APPLE_MUSIC = process.env.MOCK_APPLE_MUSIC === "true";

const mockAppleMusicTracks: PairTrack[] = [
  {
    apple_music_id: "1544494996",
    track_name: "Blinding Lights",
    artist_name: "The Weeknd",
    album_name: "After Hours",
    album_art_url: "https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/ab/0c/e2/ab0ce2c5-8e5c-4c5d-8c5c-8e5c4c5d8c5c/source/600x600bb.jpg",
    preview_url: "https://audio-ssl.itunes.apple.com/preview.m4a",
    duration_ms: 200040,
    release_date: "2020-03-20",
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
    preview_url: "https://audio-ssl.itunes.apple.com/preview2.m4a",
    duration_ms: 354320,
    release_date: "1975-10-31",
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
    preview_url: "https://audio-ssl.itunes.apple.com/preview3.m4a",
    duration_ms: 194088,
    release_date: "2019-03-29",
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
    preview_url: "https://audio-ssl.itunes.apple.com/preview4.m4a",
    duration_ms: 174000,
    release_date: "2019-12-13",
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
    preview_url: "https://audio-ssl.itunes.apple.com/preview5.m4a",
    duration_ms: 238805,
    release_date: "2020-08-07",
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
    preview_url: "https://audio-ssl.itunes.apple.com/preview6.m4a",
    duration_ms: 203064,
    release_date: "2020-03-27",
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
    preview_url: "https://audio-ssl.itunes.apple.com/preview7.m4a",
    duration_ms: 242014,
    release_date: "2021-01-08",
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
    preview_url: "https://audio-ssl.itunes.apple.com/preview8.m4a",
    duration_ms: 482830,
    release_date: "1971-11-08",
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
    preview_url: "https://audio-ssl.itunes.apple.com/preview9.m4a",
    duration_ms: 215280,
    release_date: "2019-09-06",
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
    preview_url: "https://audio-ssl.itunes.apple.com/preview10.m4a",
    duration_ms: 301920,
    release_date: "1991-09-10",
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
    preview_url: "https://audio-ssl.itunes.apple.com/preview11.m4a",
    duration_ms: 141806,
    release_date: "2021-07-09",
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
    preview_url: "https://audio-ssl.itunes.apple.com/preview12.m4a",
    duration_ms: 390480,
    release_date: "1977-02-22",
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
    preview_url: "https://audio-ssl.itunes.apple.com/preview13.m4a",
    duration_ms: 198082,
    release_date: "2021-03-19",
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
    preview_url: "https://audio-ssl.itunes.apple.com/preview14.m4a",
    duration_ms: 219173,
    release_date: "1991-09-10",
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
    preview_url: "https://audio-ssl.itunes.apple.com/preview15.m4a",
    duration_ms: 215627,
    release_date: "2020-03-20",
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
    preview_url: "https://audio-ssl.itunes.apple.com/preview16.m4a",
    duration_ms: 183290,
    release_date: "2019-11-01",
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
    preview_url: "https://audio-ssl.itunes.apple.com/preview17.m4a",
    duration_ms: 178147,
    release_date: "2021-05-14",
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
    preview_url: "https://audio-ssl.itunes.apple.com/preview18.m4a",
    duration_ms: 232000,
    release_date: "2020-08-07",
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
    preview_url: "https://audio-ssl.itunes.apple.com/preview19.m4a",
    duration_ms: 158040,
    release_date: "2018-10-18",
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
    preview_url: "https://audio-ssl.itunes.apple.com/preview20.m4a",
    duration_ms: 207133,
    release_date: "2019-12-06",
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
  if (MOCK_APPLE_MUSIC) {
    const lowerQuery = query.toLowerCase();
    return mockAppleMusicTracks.filter(
      (track) =>
        track.track_name.toLowerCase().includes(lowerQuery) ||
        track.artist_name.toLowerCase().includes(lowerQuery)
    ).slice(0, limit);
  }

  // Get developer token (generated dynamically from private key)
  const developerToken = await getAppleMusicDeveloperToken();
  if (!developerToken) {
    console.warn("Apple Music API token not available, using mock data");
    return mockAppleMusicTracks.slice(0, limit);
  }

  try {
    const response = await fetch(
      `https://api.music.apple.com/v1/catalog/us/search?term=${encodeURIComponent(query)}&types=songs&limit=${limit}`,
      {
        headers: {
          Authorization: `Bearer ${developerToken}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Apple Music API error: ${response.status}`);
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
    return mockAppleMusicTracks.slice(0, limit);
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

export { mockAppleMusicTracks };
