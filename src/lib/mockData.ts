import { SpotifyTrack, AudioFeatures } from "./spotify";

const MOCK_TRACKS: SpotifyTrack[] = [
  {
    track_id: "mock_001",
    track_name: "Midnight City",
    artist_name: "M83",
    artist_id: "artist_001",
    album_art_url: "https://placehold.co/300x300/1a1a2e/ffffff?text=M83",
    preview_url: "https://p.scdn.co/mp3-preview/mock1",
    spotify_url: "https://open.spotify.com/track/mock_001",
  },
  {
    track_id: "mock_002",
    track_name: "Blinding Lights",
    artist_name: "The Weeknd",
    artist_id: "artist_002",
    album_art_url: "https://placehold.co/300x300/e94560/ffffff?text=Weeknd",
    preview_url: "https://p.scdn.co/mp3-preview/mock2",
    spotify_url: "https://open.spotify.com/track/mock_002",
  },
  {
    track_id: "mock_003",
    track_name: "Electric Feel",
    artist_name: "MGMT",
    artist_id: "artist_003",
    album_art_url: "https://placehold.co/300x300/16213e/ffffff?text=MGMT",
    preview_url: "https://p.scdn.co/mp3-preview/mock3",
    spotify_url: "https://open.spotify.com/track/mock_003",
  },
  {
    track_id: "mock_004",
    track_name: "Starboy",
    artist_name: "The Weeknd",
    artist_id: "artist_002",
    album_art_url: "https://placehold.co/300x300/e94560/ffffff?text=Weeknd",
    preview_url: "https://p.scdn.co/mp3-preview/mock4",
    spotify_url: "https://open.spotify.com/track/mock_004",
  },
  {
    track_id: "mock_005",
    track_name: "Intro",
    artist_name: "The xx",
    artist_id: "artist_004",
    album_art_url: "https://placehold.co/300x300/0f3460/ffffff?text=The+xx",
    preview_url: "https://p.scdn.co/mp3-preview/mock5",
    spotify_url: "https://open.spotify.com/track/mock_005",
  },
  {
    track_id: "mock_006",
    track_name: "Crystalised",
    artist_name: "The xx",
    artist_id: "artist_004",
    album_art_url: "https://placehold.co/300x300/0f3460/ffffff?text=The+xx",
    preview_url: "https://p.scdn.co/mp3-preview/mock6",
    spotify_url: "https://open.spotify.com/track/mock_006",
  },
  {
    track_id: "mock_007",
    track_name: "Tame Impala",
    artist_name: "Let It Happen",
    artist_id: "artist_005",
    album_art_url: "https://placehold.co/300x300/533483/ffffff?text=Tame",
    preview_url: "https://p.scdn.co/mp3-preview/mock7",
    spotify_url: "https://open.spotify.com/track/mock_007",
  },
  {
    track_id: "mock_008",
    track_name: "The Less I Know The Better",
    artist_name: "Tame Impala",
    artist_id: "artist_005",
    album_art_url: "https://placehold.co/300x300/533483/ffffff?text=Tame",
    preview_url: "https://p.scdn.co/mp3-preview/mock8",
    spotify_url: "https://open.spotify.com/track/mock_008",
  },
  {
    track_id: "mock_009",
    track_name: "Do I Wanna Know?",
    artist_name: "Arctic Monkeys",
    artist_id: "artist_006",
    album_art_url: "https://placehold.co/300x300/1a1a2e/ffffff?text=AM",
    preview_url: "https://p.scdn.co/mp3-preview/mock9",
    spotify_url: "https://open.spotify.com/track/mock_009",
  },
  {
    track_id: "mock_010",
    track_name: "R U Mine?",
    artist_name: "Arctic Monkeys",
    artist_id: "artist_006",
    album_art_url: "https://placehold.co/300x300/1a1a2e/ffffff?text=AM",
    preview_url: "https://p.scdn.co/mp3-preview/mock10",
    spotify_url: "https://open.spotify.com/track/mock_010",
  },
  {
    track_id: "mock_011",
    track_name: "Somebody Else",
    artist_name: "The 1975",
    artist_id: "artist_007",
    album_art_url: "https://placehold.co/300x300/e94560/ffffff?text=1975",
    preview_url: "https://p.scdn.co/mp3-preview/mock11",
    spotify_url: "https://open.spotify.com/track/mock_011",
  },
  {
    track_id: "mock_012",
    track_name: "Robbers",
    artist_name: "The 1975",
    artist_id: "artist_007",
    album_art_url: "https://placehold.co/300x300/e94560/ffffff?text=1975",
    preview_url: "https://p.scdn.co/mp3-preview/mock12",
    spotify_url: "https://open.spotify.com/track/mock_012",
  },
  {
    track_id: "mock_013",
    track_name: "Redbone",
    artist_name: "Childish Gambino",
    artist_id: "artist_008",
    album_art_url: "https://placehold.co/300x300/16213e/ffffff?text=Gambino",
    preview_url: "https://p.scdn.co/mp3-preview/mock13",
    spotify_url: "https://open.spotify.com/track/mock_013",
  },
  {
    track_id: "mock_014",
    track_name: "3005",
    artist_name: "Childish Gambino",
    artist_id: "artist_008",
    album_art_url: "https://placehold.co/300x300/16213e/ffffff?text=Gambino",
    preview_url: "https://p.scdn.co/mp3-preview/mock14",
    spotify_url: "https://open.spotify.com/track/mock_014",
  },
  {
    track_id: "mock_015",
    track_name: "Nights",
    artist_name: "Frank Ocean",
    artist_id: "artist_009",
    album_art_url: "https://placehold.co/300x300/0f3460/ffffff?text=Frank",
    preview_url: "https://p.scdn.co/mp3-preview/mock15",
    spotify_url: "https://open.spotify.com/track/mock_015",
  },
  {
    track_id: "mock_016",
    track_name: "Pink + White",
    artist_name: "Frank Ocean",
    artist_id: "artist_009",
    album_art_url: "https://placehold.co/300x300/0f3460/ffffff?text=Frank",
    preview_url: "https://p.scdn.co/mp3-preview/mock16",
    spotify_url: "https://open.spotify.com/track/mock_016",
  },
  {
    track_id: "mock_017",
    track_name: "Ivy",
    artist_name: "Frank Ocean",
    artist_id: "artist_009",
    album_art_url: "https://placehold.co/300x300/0f3460/ffffff?text=Frank",
    preview_url: "https://p.scdn.co/mp3-preview/mock17",
    spotify_url: "https://open.spotify.com/track/mock_017",
  },
  {
    track_id: "mock_018",
    track_name: "Motion Sickness",
    artist_name: "Phoebe Bridgers",
    artist_id: "artist_010",
    album_art_url: "https://placehold.co/300x300/533483/ffffff?text=Phoebe",
    preview_url: "https://p.scdn.co/mp3-preview/mock18",
    spotify_url: "https://open.spotify.com/track/mock_018",
  },
  {
    track_id: "mock_019",
    track_name: "Kyoto",
    artist_name: "Phoebe Bridgers",
    artist_id: "artist_010",
    album_art_url: "https://placehold.co/300x300/533483/ffffff?text=Phoebe",
    preview_url: "https://p.scdn.co/mp3-preview/mock19",
    spotify_url: "https://open.spotify.com/track/mock_019",
  },
  {
    track_id: "mock_020",
    track_name: "Heat Waves",
    artist_name: "Glass Animals",
    artist_id: "artist_011",
    album_art_url: "https://placehold.co/300x300/e94560/ffffff?text=Glass",
    preview_url: "https://p.scdn.co/mp3-preview/mock20",
    spotify_url: "https://open.spotify.com/track/mock_020",
  },
  {
    track_id: "mock_021",
    track_name: "Gooey",
    artist_name: "Glass Animals",
    artist_id: "artist_011",
    album_art_url: "https://placehold.co/300x300/e94560/ffffff?text=Glass",
    preview_url: "https://p.scdn.co/mp3-preview/mock21",
    spotify_url: "https://open.spotify.com/track/mock_021",
  },
  {
    track_id: "mock_022",
    track_name: "Space Song",
    artist_name: "Beach House",
    artist_id: "artist_012",
    album_art_url: "https://placehold.co/300x300/16213e/ffffff?text=Beach",
    preview_url: "https://p.scdn.co/mp3-preview/mock22",
    spotify_url: "https://open.spotify.com/track/mock_022",
  },
  {
    track_id: "mock_023",
    track_name: "Myth",
    artist_name: "Beach House",
    artist_id: "artist_012",
    album_art_url: "https://placehold.co/300x300/16213e/ffffff?text=Beach",
    preview_url: "https://p.scdn.co/mp3-preview/mock23",
    spotify_url: "https://open.spotify.com/track/mock_023",
  },
  {
    track_id: "mock_024",
    track_name: "Dissolve",
    artist_name: "Absofacto",
    artist_id: "artist_013",
    album_art_url: "https://placehold.co/300x300/0f3460/ffffff?text=Absofacto",
    preview_url: "https://p.scdn.co/mp3-preview/mock24",
    spotify_url: "https://open.spotify.com/track/mock_024",
  },
  {
    track_id: "mock_025",
    track_name: "Sweater Weather",
    artist_name: "The Neighbourhood",
    artist_id: "artist_014",
    album_art_url: "https://placehold.co/300x300/1a1a2e/ffffff?text=NBHD",
    preview_url: "https://p.scdn.co/mp3-preview/mock25",
    spotify_url: "https://open.spotify.com/track/mock_025",
  },
];

const MOCK_AUDIO_FEATURES: Record<string, AudioFeatures> = {
  mock_001: { track_id: "mock_001", danceability: 0.56, energy: 0.74, valence: 0.38, tempo: 105, acousticness: 0.02, instrumentalness: 0.81, loudness: -7.2 },
  mock_002: { track_id: "mock_002", danceability: 0.51, energy: 0.73, valence: 0.33, tempo: 171, acousticness: 0.00, instrumentalness: 0.00, loudness: -5.9 },
  mock_003: { track_id: "mock_003", danceability: 0.78, energy: 0.70, valence: 0.71, tempo: 120, acousticness: 0.01, instrumentalness: 0.02, loudness: -4.8 },
  mock_004: { track_id: "mock_004", danceability: 0.68, energy: 0.59, valence: 0.49, tempo: 186, acousticness: 0.14, instrumentalness: 0.00, loudness: -7.0 },
  mock_005: { track_id: "mock_005", danceability: 0.33, energy: 0.22, valence: 0.18, tempo: 120, acousticness: 0.01, instrumentalness: 0.95, loudness: -14.5 },
  mock_006: { track_id: "mock_006", danceability: 0.62, energy: 0.45, valence: 0.32, tempo: 130, acousticness: 0.03, instrumentalness: 0.00, loudness: -9.8 },
  mock_007: { track_id: "mock_007", danceability: 0.52, energy: 0.82, valence: 0.54, tempo: 118, acousticness: 0.01, instrumentalness: 0.01, loudness: -4.2 },
  mock_008: { track_id: "mock_008", danceability: 0.64, energy: 0.74, valence: 0.78, tempo: 116, acousticness: 0.02, instrumentalness: 0.00, loudness: -4.6 },
  mock_009: { track_id: "mock_009", danceability: 0.55, energy: 0.54, valence: 0.15, tempo: 85, acousticness: 0.06, instrumentalness: 0.00, loudness: -5.8 },
  mock_010: { track_id: "mock_010", danceability: 0.55, energy: 0.87, valence: 0.54, tempo: 101, acousticness: 0.00, instrumentalness: 0.00, loudness: -3.4 },
  mock_011: { track_id: "mock_011", danceability: 0.58, energy: 0.48, valence: 0.22, tempo: 120, acousticness: 0.05, instrumentalness: 0.00, loudness: -7.1 },
  mock_012: { track_id: "mock_012", danceability: 0.45, energy: 0.62, valence: 0.28, tempo: 120, acousticness: 0.01, instrumentalness: 0.00, loudness: -5.2 },
  mock_013: { track_id: "mock_013", danceability: 0.74, energy: 0.35, valence: 0.57, tempo: 90, acousticness: 0.60, instrumentalness: 0.00, loudness: -10.2 },
  mock_014: { track_id: "mock_014", danceability: 0.70, energy: 0.65, valence: 0.72, tempo: 140, acousticness: 0.02, instrumentalness: 0.00, loudness: -5.8 },
  mock_015: { track_id: "mock_015", danceability: 0.45, energy: 0.55, valence: 0.42, tempo: 90, acousticness: 0.12, instrumentalness: 0.00, loudness: -8.5 },
  mock_016: { track_id: "mock_016", danceability: 0.52, energy: 0.48, valence: 0.65, tempo: 80, acousticness: 0.35, instrumentalness: 0.00, loudness: -9.2 },
  mock_017: { track_id: "mock_017", danceability: 0.38, energy: 0.42, valence: 0.35, tempo: 68, acousticness: 0.45, instrumentalness: 0.00, loudness: -10.8 },
  mock_018: { track_id: "mock_018", danceability: 0.48, energy: 0.52, valence: 0.28, tempo: 148, acousticness: 0.08, instrumentalness: 0.00, loudness: -6.5 },
  mock_019: { track_id: "mock_019", danceability: 0.62, energy: 0.68, valence: 0.45, tempo: 152, acousticness: 0.02, instrumentalness: 0.00, loudness: -5.2 },
  mock_020: { track_id: "mock_020", danceability: 0.76, energy: 0.53, valence: 0.32, tempo: 80, acousticness: 0.18, instrumentalness: 0.00, loudness: -7.8 },
  mock_021: { track_id: "mock_021", danceability: 0.68, energy: 0.62, valence: 0.58, tempo: 100, acousticness: 0.05, instrumentalness: 0.02, loudness: -6.2 },
  mock_022: { track_id: "mock_022", danceability: 0.42, energy: 0.38, valence: 0.25, tempo: 145, acousticness: 0.02, instrumentalness: 0.85, loudness: -8.5 },
  mock_023: { track_id: "mock_023", danceability: 0.48, energy: 0.55, valence: 0.35, tempo: 128, acousticness: 0.01, instrumentalness: 0.02, loudness: -7.2 },
  mock_024: { track_id: "mock_024", danceability: 0.65, energy: 0.58, valence: 0.42, tempo: 110, acousticness: 0.08, instrumentalness: 0.00, loudness: -6.8 },
  mock_025: { track_id: "mock_025", danceability: 0.61, energy: 0.68, valence: 0.32, tempo: 124, acousticness: 0.01, instrumentalness: 0.00, loudness: -5.5 },
};

const MOCK_GENRES: Record<string, string[]> = {
  artist_001: ["electronic", "synthwave", "dream pop"],
  artist_002: ["r&b", "pop", "synth-pop"],
  artist_003: ["psychedelic pop", "indie pop", "electronic"],
  artist_004: ["indie pop", "dream pop", "electronic"],
  artist_005: ["psychedelic rock", "indie rock", "synth-pop"],
  artist_006: ["indie rock", "alternative rock", "garage rock"],
  artist_007: ["indie pop", "synth-pop", "alternative rock"],
  artist_008: ["hip hop", "r&b", "funk"],
  artist_009: ["r&b", "neo soul", "alternative r&b"],
  artist_010: ["indie folk", "indie rock", "sad girl"],
  artist_011: ["psychedelic pop", "indie pop", "electronic"],
  artist_012: ["dream pop", "shoegaze", "indie pop"],
  artist_013: ["indie pop", "electronic", "synth-pop"],
  artist_014: ["indie rock", "alternative rock", "dark pop"],
};

const RELATED_ARTISTS: Record<string, string[]> = {
  artist_001: ["artist_003", "artist_004", "artist_012"],
  artist_002: ["artist_008", "artist_009"],
  artist_003: ["artist_001", "artist_005", "artist_011"],
  artist_004: ["artist_001", "artist_012", "artist_014"],
  artist_005: ["artist_003", "artist_011", "artist_006"],
  artist_006: ["artist_005", "artist_007", "artist_014"],
  artist_007: ["artist_006", "artist_014", "artist_004"],
  artist_008: ["artist_002", "artist_009"],
  artist_009: ["artist_002", "artist_008", "artist_013"],
  artist_010: ["artist_012", "artist_004"],
  artist_011: ["artist_003", "artist_005", "artist_001"],
  artist_012: ["artist_004", "artist_001", "artist_010"],
  artist_013: ["artist_003", "artist_011"],
  artist_014: ["artist_006", "artist_007", "artist_004"],
};

export function mockSearchTracks(query: string, limit: number = 10): SpotifyTrack[] {
  const lowerQuery = query.toLowerCase();
  const results = MOCK_TRACKS.filter(
    (track) =>
      track.track_name.toLowerCase().includes(lowerQuery) ||
      track.artist_name.toLowerCase().includes(lowerQuery)
  );
  
  if (results.length === 0) {
    return MOCK_TRACKS.slice(0, limit);
  }
  
  return results.slice(0, limit);
}

export function mockGetTrack(trackId: string): SpotifyTrack | null {
  return MOCK_TRACKS.find((t) => t.track_id === trackId) || MOCK_TRACKS[0];
}

export function mockGetAudioFeatures(trackIds: string[]): AudioFeatures[] {
  return trackIds
    .map((id) => MOCK_AUDIO_FEATURES[id])
    .filter((f): f is AudioFeatures => f !== undefined);
}

export function mockGetRecommendations(seedTrackId: string, limit: number = 100): SpotifyTrack[] {
  const seedTrack = MOCK_TRACKS.find((t) => t.track_id === seedTrackId);
  if (!seedTrack) {
    return MOCK_TRACKS.slice(0, limit);
  }
  
  const otherTracks = MOCK_TRACKS.filter((t) => t.track_id !== seedTrackId);
  return otherTracks.slice(0, limit);
}

export function mockGetRelatedArtists(artistId: string): string[] {
  return RELATED_ARTISTS[artistId] || Object.keys(RELATED_ARTISTS).slice(0, 3);
}

export function mockGetArtistTopTracks(artistId: string): SpotifyTrack[] {
  return MOCK_TRACKS.filter((t) => t.artist_id === artistId).slice(0, 5);
}

export function mockGetArtistGenres(artistId: string): string[] {
  return MOCK_GENRES[artistId] || ["indie", "alternative"];
}

export const MOCK_TRACKS_LIST = MOCK_TRACKS;
