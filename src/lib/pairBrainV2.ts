// Pair Brain v2 - 6-Track Pairing Engine
// Implements the Pair Algorithm Spec v1
// No third-party similarity APIs. Apple Music is catalog only. Pair owns taste.

import { PairTrack, getAppleMusicTrack, searchAppleMusicTracks } from "./appleMusic";
import { supabase } from "./supabase";

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export type PairingMode = "same_sound" | "same_vibe" | "same_scene" | "adventure";
export type SlotType = "core" | "flavor" | "wildcard";

export interface PairingInput {
  seed_track_apple_id: string;
  prompt_text?: string;
  mode: PairingMode;
  user_id?: string;
  session_id?: string;
}

export interface SlottedTrack {
  track: PairTrack;
  slot_type: SlotType;
  slot_position: number;
  similarity_score: number;
  audio_similarity: number;
  text_similarity: number;
  scene_similarity: number;
  explanation: string;
}

export interface PairingResult {
  tracks: SlottedTrack[];
  seed_track: PairTrack;
  mode: PairingMode;
  session_id: string;
  excluded_count: number;
}

interface ScoredCandidate {
  track: PairTrack;
  total_score: number;
  audio_similarity: number;
  text_similarity: number;
  scene_similarity: number;
  user_vector_similarity: number;
}

interface ExclusionSets {
  owned_tracks: Set<string>;      // In user's playlists - never show
  disliked_tracks: Set<string>;   // Disliked - never show
  session_tracks: Set<string>;    // Already shown this session
  recent_tracks: Map<string, Date>; // Shown recently - cooldown
}

interface UserTasteVector {
  energy: number;
  valence: number;
  danceability: number;
  acousticness: number;
  instrumentalness: number;
  tempo: number;
  loudness: number;
  preferred_genres: string[];
  positive_count: number;
  negative_count: number;
}

// ============================================================================
// MODE CONFIGURATION (From Spec)
// ============================================================================

interface ModeConfig {
  audio_weight: number;
  text_weight: number;
  scene_weight: number;
  core_threshold: number;
  flavor_threshold: number;
  wildcard_min?: number;
  wildcard_max?: number;
  description: string;
}

const MODE_CONFIG: Record<PairingMode, ModeConfig> = {
  // Same Sound: Match sonic DNA - tempo, timbre, instrumentation, production texture
  same_sound: {
    audio_weight: 0.70,
    text_weight: 0.20,
    scene_weight: 0.10,
    core_threshold: 0.72,
    flavor_threshold: 0.62,
    description: "Songs that sound like this"
  },
  
  // Same Vibe: Match emotional tone, atmosphere, energy arc; allow genre crossing
  same_vibe: {
    audio_weight: 0.45,
    text_weight: 0.45,
    scene_weight: 0.10,
    core_threshold: 0.70,
    flavor_threshold: 0.60,
    description: "Songs that feel the same, even if they sound different"
  },
  
  // Same Scene: Match cultural adjacency - artist graph, era, movements
  same_scene: {
    audio_weight: 0.15,
    text_weight: 0.25,
    scene_weight: 0.60,
    core_threshold: 0.65,
    flavor_threshold: 0.55,
    description: "Music from the same world"
  },
  
  // Adventure: Controlled exploration with guardrails
  adventure: {
    audio_weight: 0.30,
    text_weight: 0.30,
    scene_weight: 0.40,
    core_threshold: 0.60,
    flavor_threshold: 0.50,
    wildcard_min: 0.55,
    wildcard_max: 0.78,
    description: "Unexpected picks that still belong"
  }
};

// Cooldown period for seen tracks (days)
const COOLDOWN_DAYS = 14;

// ============================================================================
// EXCLUSION LOGIC (No Recycling Rule)
// ============================================================================

async function getExclusionSets(userId: string, sessionId: string): Promise<ExclusionSets> {
  const exclusions: ExclusionSets = {
    owned_tracks: new Set(),
    disliked_tracks: new Set(),
    session_tracks: new Set(),
    recent_tracks: new Map()
  };

  if (!userId) return exclusions;

  try {
    // Get owned tracks (in playlists - never show again)
    const { data: ownedTracks } = await supabase
      .from("user_owned_tracks")
      .select("apple_music_id")
      .eq("user_id", userId);

    if (ownedTracks) {
      for (const t of ownedTracks) {
        exclusions.owned_tracks.add(t.apple_music_id);
      }
    }

    // Get disliked tracks (never show again)
    const { data: dislikedTracks } = await supabase
      .from("user_disliked_tracks")
      .select("apple_music_id")
      .eq("user_id", userId);

    if (dislikedTracks) {
      for (const t of dislikedTracks) {
        exclusions.disliked_tracks.add(t.apple_music_id);
      }
    }

    // Get tracks shown in current session
    const { data: sessionTracks } = await supabase
      .from("pairing_history")
      .select("recommended_track_id, pair_tracks!pairing_history_recommended_track_id_fkey(apple_music_id)")
      .eq("session_id", sessionId);

    if (sessionTracks) {
      for (const t of sessionTracks) {
        const trackData = t.pair_tracks as unknown;
        const pairTrack = (Array.isArray(trackData) ? trackData[0] : trackData) as { apple_music_id: string } | null;
        if (pairTrack?.apple_music_id) {
          exclusions.session_tracks.add(pairTrack.apple_music_id);
        }
      }
    }

    // Get recently shown tracks (cooldown period)
    const cooldownDate = new Date();
    cooldownDate.setDate(cooldownDate.getDate() - COOLDOWN_DAYS);

    const { data: recentTracks } = await supabase
      .from("pairing_history")
      .select("recommended_track_id, created_at, pair_tracks!pairing_history_recommended_track_id_fkey(apple_music_id)")
      .eq("user_id", userId)
      .gte("created_at", cooldownDate.toISOString());

    if (recentTracks) {
      for (const t of recentTracks) {
        const trackData = t.pair_tracks as unknown;
        const pairTrack = (Array.isArray(trackData) ? trackData[0] : trackData) as { apple_music_id: string } | null;
        if (pairTrack?.apple_music_id) {
          exclusions.recent_tracks.set(pairTrack.apple_music_id, new Date(t.created_at));
        }
      }
    }

    // Also get tracks from playlist_tracks table
    const { data: playlistTracks } = await supabase
      .from("playlist_tracks")
      .select("track_id, playlists!inner(owner_id)")
      .eq("playlists.owner_id", userId);

    if (playlistTracks) {
      // Get apple_music_ids for these tracks
      const trackIds = playlistTracks.map(t => t.track_id);
      if (trackIds.length > 0) {
        const { data: trackDetails } = await supabase
          .from("pair_tracks")
          .select("apple_music_id")
          .in("id", trackIds);

        if (trackDetails) {
          for (const t of trackDetails) {
            exclusions.owned_tracks.add(t.apple_music_id);
          }
        }
      }
    }
  } catch (error) {
    console.error("Error fetching exclusion sets:", error);
  }

  return exclusions;
}

function shouldExclude(trackId: string, exclusions: ExclusionSets): boolean {
  if (exclusions.owned_tracks.has(trackId)) return true;
  if (exclusions.disliked_tracks.has(trackId)) return true;
  if (exclusions.session_tracks.has(trackId)) return true;
  if (exclusions.recent_tracks.has(trackId)) return true;
  return false;
}

// ============================================================================
// USER TASTE VECTOR
// ============================================================================

async function getUserTasteVector(userId: string): Promise<UserTasteVector | null> {
  if (!userId) return null;

  try {
    const { data } = await supabase
      .from("user_taste_vectors")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (data) {
      return {
        energy: data.preferred_energy || 0.5,
        valence: data.preferred_valence || 0.5,
        danceability: data.preferred_danceability || 0.5,
        acousticness: data.preferred_acousticness || 0.5,
        instrumentalness: data.preferred_instrumentalness || 0.5,
        tempo: data.preferred_tempo || 120,
        loudness: data.preferred_loudness || -10,
        preferred_genres: data.preferred_genres || [],
        positive_count: data.positive_track_count || 0,
        negative_count: data.negative_track_count || 0
      };
    }
  } catch {
    // No taste vector yet
  }

  return null;
}

// ============================================================================
// SIMILARITY COMPUTATIONS
// ============================================================================

function computeAudioSimilarity(seed: PairTrack, candidate: PairTrack): number {
  // Cosine similarity over audio features
  const features = [
    { name: "energy", weight: 1.0 },
    { name: "valence", weight: 1.0 },
    { name: "danceability", weight: 1.0 },
    { name: "acousticness", weight: 0.8 },
    { name: "instrumentalness", weight: 0.6 },
    { name: "tempo", weight: 0.5, normalize: 200 }
  ];

  let dotProduct = 0;
  let normSeed = 0;
  let normCandidate = 0;

  for (const f of features) {
    const seedVal = (seed[f.name as keyof PairTrack] as number) ?? 0.5;
    const candidateVal = (candidate[f.name as keyof PairTrack] as number) ?? 0.5;
    
    // Normalize tempo to 0-1 range
    const normalizedSeed = f.normalize ? Math.min(1, seedVal / f.normalize) : seedVal;
    const normalizedCandidate = f.normalize ? Math.min(1, candidateVal / f.normalize) : candidateVal;
    
    const weightedSeed = normalizedSeed * f.weight;
    const weightedCandidate = normalizedCandidate * f.weight;
    
    dotProduct += weightedSeed * weightedCandidate;
    normSeed += weightedSeed * weightedSeed;
    normCandidate += weightedCandidate * weightedCandidate;
  }

  if (normSeed === 0 || normCandidate === 0) return 0;
  return dotProduct / (Math.sqrt(normSeed) * Math.sqrt(normCandidate));
}

function computeTextSimilarity(
  seedTrack: PairTrack,
  candidate: PairTrack,
  promptText?: string
): number {
  // Simple text-based similarity without OpenAI (per spec: "Do NOT use ChatGPT for selecting songs")
  // Uses word overlap between track metadata
  
  const seedWords = new Set(
    `${seedTrack.track_name} ${seedTrack.artist_name} ${seedTrack.genres?.join(" ") || ""} ${promptText || ""}`
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 2)
  );
  
  const candidateWords = new Set(
    `${candidate.track_name} ${candidate.artist_name} ${candidate.genres?.join(" ") || ""}`
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 2)
  );
  
  // Calculate Jaccard similarity
  const intersection = [...seedWords].filter(w => candidateWords.has(w)).length;
  const union = new Set([...seedWords, ...candidateWords]).size;
  
  if (union === 0) return 0.5;
  
  // Scale to 0-1 range with some baseline
  return 0.3 + (intersection / union) * 0.7;
}

// Genre compatibility check - returns true if genres are compatible
function areGenresCompatible(seedGenres: string[] | undefined, candidateGenres: string[] | undefined): boolean {
  // If seed has no genres, we can't filter - allow all
  if (!seedGenres || seedGenres.length === 0) return true;
  
  // STRICT: If candidate has no genres, REJECT it (don't allow unknown tracks)
  if (!candidateGenres || candidateGenres.length === 0) return false;
  
  const seedGenresLower = seedGenres.map(g => g.toLowerCase());
  const candidateGenresLower = candidateGenres.map(g => g.toLowerCase());
  
  // Define genre families - tracks must share at least one family
  const genreFamilies: Record<string, string[]> = {
    electronic: ['electronic', 'edm', 'dance', 'house', 'techno', 'trance', 'dubstep', 'drum and bass', 'electro', 'future bass', 'progressive house', 'big room', 'tropical house', 'deep house', 'tech house', 'electronica', 'synth', 'ambient'],
    hiphop: ['hip-hop', 'hip hop', 'rap', 'trap', 'r&b', 'rnb', 'urban', 'drill', 'grime'],
    rock: ['rock', 'alternative', 'indie rock', 'punk', 'metal', 'grunge', 'hard rock', 'classic rock', 'progressive rock', 'british invasion'],
    pop: ['pop', 'dance pop', 'synth pop', 'electropop', 'indie pop', 'art pop', 'k-pop', 'j-pop'],
    country: ['country', 'americana', 'folk', 'bluegrass', 'country rock'],
    jazz: ['jazz', 'blues', 'soul', 'funk', 'neo-soul'],
    classical: ['classical', 'orchestral', 'opera', 'symphony', 'chamber'],
    latin: ['latin', 'reggaeton', 'salsa', 'bachata', 'cumbia', 'latin pop'],
    world: ['world', 'afrobeat', 'reggae', 'dancehall', 'caribbean']
  };
  
  // Find which families the seed belongs to
  const seedFamilies = new Set<string>();
  for (const [family, keywords] of Object.entries(genreFamilies)) {
    for (const genre of seedGenresLower) {
      if (keywords.some(kw => genre.includes(kw))) {
        seedFamilies.add(family);
      }
    }
  }
  
  // Find which families the candidate belongs to
  const candidateFamilies = new Set<string>();
  for (const [family, keywords] of Object.entries(genreFamilies)) {
    for (const genre of candidateGenresLower) {
      if (keywords.some(kw => genre.includes(kw))) {
        candidateFamilies.add(family);
      }
    }
  }
  
  // STRICT: If we can categorize the seed but NOT the candidate, REJECT
  // This prevents random uncategorized tracks from slipping through
  if (seedFamilies.size > 0 && candidateFamilies.size === 0) {
    console.log(`Genre filter REJECT: candidate genres [${candidateGenresLower.join(', ')}] don't match any family`);
    return false;
  }
  
  // If we couldn't categorize the seed, allow the match (rare case)
  if (seedFamilies.size === 0) return true;
  
  // Check for family overlap
  for (const family of seedFamilies) {
    if (candidateFamilies.has(family)) return true;
  }
  
  // Also allow pop to match with electronic (common crossover)
  if ((seedFamilies.has('pop') && candidateFamilies.has('electronic')) ||
      (seedFamilies.has('electronic') && candidateFamilies.has('pop'))) {
    return true;
  }
  
  console.log(`Genre filter REJECT: seed families [${Array.from(seedFamilies).join(', ')}] vs candidate families [${Array.from(candidateFamilies).join(', ')}]`);
  return false;
}

function computeSceneSimilarity(seed: PairTrack, candidate: PairTrack): number {
  let score = 0;
  let factors = 0;

  // Genre overlap - now weighted more heavily
  if (seed.genres && candidate.genres) {
    const seedGenres = new Set(seed.genres.map(g => g.toLowerCase()));
    const candidateGenres = new Set(candidate.genres.map(g => g.toLowerCase()));
    const overlap = [...seedGenres].filter(g => candidateGenres.has(g)).length;
    const total = new Set([...seedGenres, ...candidateGenres]).size;
    if (total > 0) {
      // Exact genre match is very important
      const genreScore = overlap / total;
      score += genreScore * 0.5; // Increased from 0.4
      factors += 0.5;
      
      // Bonus for genre family match
      if (areGenresCompatible(seed.genres, candidate.genres)) {
        score += 0.1;
      }
    }
  }

  // Era similarity (release date)
  if (seed.release_date && candidate.release_date) {
    const seedYear = parseInt(seed.release_date.substring(0, 4));
    const candidateYear = parseInt(candidate.release_date.substring(0, 4));
    if (!isNaN(seedYear) && !isNaN(candidateYear)) {
      const yearDiff = Math.abs(seedYear - candidateYear);
      // Within 5 years = high similarity, decreases after
      const eraSimilarity = Math.max(0, 1 - (yearDiff / 20));
      score += eraSimilarity * 0.25;
      factors += 0.25;
    }
  }

  // Artist adjacency (same first letter = weak signal, same word = stronger)
  const seedArtistWords = seed.artist_name.toLowerCase().split(/\s+/);
  const candidateArtistWords = candidate.artist_name.toLowerCase().split(/\s+/);
  const artistOverlap = seedArtistWords.filter(w => candidateArtistWords.includes(w)).length;
  if (artistOverlap > 0) {
    score += 0.15;
    factors += 0.25;
  } else {
    factors += 0.25;
  }

  return factors > 0 ? score / factors : 0.3; // Lower default for unknown
}

function computeUserVectorSimilarity(track: PairTrack, userVector: UserTasteVector | null): number {
  if (!userVector || userVector.positive_count < 3) {
    return 0.5; // Not enough data
  }

  const features = ["energy", "valence", "danceability", "acousticness", "instrumentalness"] as const;
  let dotProduct = 0;
  let normTrack = 0;
  let normUser = 0;

  for (const feature of features) {
    const trackVal = (track[feature] as number) ?? 0.5;
    const userVal = userVector[feature] ?? 0.5;
    
    dotProduct += trackVal * userVal;
    normTrack += trackVal * trackVal;
    normUser += userVal * userVal;
  }

  // Add tempo (normalized)
  const trackTempo = Math.min(1, (track.tempo ?? 120) / 200);
  const userTempo = Math.min(1, userVector.tempo / 200);
  dotProduct += trackTempo * userTempo;
  normTrack += trackTempo * trackTempo;
  normUser += userTempo * userTempo;

  if (normTrack === 0 || normUser === 0) return 0.5;
  return dotProduct / (Math.sqrt(normTrack) * Math.sqrt(normUser));
}

// ============================================================================
// CANDIDATE GENERATION (200-500 candidates)
// ============================================================================

// Helper to sanitize search queries for Apple Music API
function sanitizeSearchQuery(query: string): string {
  // Extract primary artist (before "&", "feat.", "ft.", ",", "x ", "X ")
  let sanitized = query
    .split(/\s*[&,]\s*/)[0]  // Split on & or comma, take first part
    .split(/\s+feat\.?\s+/i)[0]  // Split on " feat " or " feat. ", take first part (with spaces)
    .split(/\s+ft\.?\s+/i)[0]  // Split on " ft " or " ft. ", take first part (with spaces)
    .split(/\s+[xX]\s+/)[0]  // Split on " x " or " X ", take first part
    .trim();
  
  // Remove special characters that might cause API issues
  sanitized = sanitized.replace(/[^\w\s'-]/g, ' ').replace(/\s+/g, ' ').trim();
  
  return sanitized || query; // Fallback to original if sanitization empties it
}

async function generateCandidates(
  seedTrack: PairTrack,
  exclusions: ExclusionSets,
  mode: PairingMode
): Promise<PairTrack[]> {
  const candidates: PairTrack[] = [];
  const seenIds = new Set<string>();
  
  // Add seed to exclusions
  seenIds.add(seedTrack.apple_music_id);
  
  let genreFilteredCount = 0;
  let seenCount = 0;
  let excludedCount = 0;
  const addCandidate = (track: PairTrack, requireGenreMatch: boolean = true): boolean => {
    if (seenIds.has(track.apple_music_id)) {
      seenCount++;
      return false;
    }
    if (shouldExclude(track.apple_music_id, exclusions)) {
      excludedCount++;
      return false;
    }
    
    // HARD FILTER: Reject tracks from incompatible genres (unless adventure mode)
    if (requireGenreMatch && mode !== "adventure") {
      if (!areGenresCompatible(seedTrack.genres, track.genres)) {
        genreFilteredCount++;
        return false;
      }
    }
    
    candidates.push(track);
    seenIds.add(track.apple_music_id);
    return true;
  };
  
  console.log(`Seed track genres: ${JSON.stringify(seedTrack.genres)}`);

  // Sanitize artist name for search queries
  const sanitizedArtist = sanitizeSearchQuery(seedTrack.artist_name);
  console.log(`Generating candidates for: ${seedTrack.track_name} by ${seedTrack.artist_name} (sanitized: ${sanitizedArtist}) (mode: ${mode})`);

  // Apple Music API has a max limit of 25 results per search
  const APPLE_MUSIC_LIMIT = 25;
  
  try {
    // STRATEGY 1: Same artist deep cuts (30% of candidates)
    const artistTracks = await searchAppleMusicTracks(sanitizedArtist, APPLE_MUSIC_LIMIT);
    console.log(`Search returned ${artistTracks.length} tracks for artist "${sanitizedArtist}"`);
    if (artistTracks.length > 0) {
      console.log(`First track genres: ${JSON.stringify(artistTracks[0].genres)}`);
    }
    for (const track of artistTracks) {
      if (candidates.length >= 60) break;
      addCandidate(track);
    }
    console.log(`After same artist: ${candidates.length} candidates (filtered: seen=${seenCount}, excluded=${excludedCount}, genre=${genreFilteredCount})`);

    // STRATEGY 2: Related artists (1-hop) - search for similar artists
    const relatedQueries = [
      `${sanitizedArtist} similar`,
      `artists like ${sanitizedArtist}`,
    ];
    for (const query of relatedQueries) {
      const relatedTracks = await searchAppleMusicTracks(query, APPLE_MUSIC_LIMIT);
      for (const track of relatedTracks) {
        if (candidates.length >= 120) break;
        addCandidate(track);
      }
    }
    console.log(`After related artists: ${candidates.length} candidates`);

    // STRATEGY 3: Genre + era matching
    if (seedTrack.genres && seedTrack.genres.length > 0) {
      const releaseYear = seedTrack.release_date?.substring(0, 4);
      for (const genre of seedTrack.genres.slice(0, 3)) {
        const genreQuery = releaseYear ? `${genre} ${releaseYear}s` : genre;
        const genreTracks = await searchAppleMusicTracks(genreQuery, APPLE_MUSIC_LIMIT);
        for (const track of genreTracks) {
          if (candidates.length >= 200) break;
          addCandidate(track);
        }
      }
    }
    console.log(`After genre matching: ${candidates.length} candidates`);

    // STRATEGY 4: Adjacent genres (for adventure mode)
    if (mode === "adventure" && seedTrack.genres) {
      const adjacentGenres = getAdjacentGenres(seedTrack.genres);
      for (const genre of adjacentGenres.slice(0, 3)) {
        const adjacentTracks = await searchAppleMusicTracks(genre, APPLE_MUSIC_LIMIT);
        for (const track of adjacentTracks) {
          if (candidates.length >= 280) break;
          addCandidate(track);
        }
      }
    }
    console.log(`After adjacent genres: ${candidates.length} candidates`);

    // STRATEGY 5: Seed track name variations
    const trackWords = seedTrack.track_name.split(/\s+/).filter(w => w.length > 3);
    for (const word of trackWords.slice(0, 2)) {
      const wordTracks = await searchAppleMusicTracks(word, APPLE_MUSIC_LIMIT);
      for (const track of wordTracks) {
        if (candidates.length >= 350) break;
        addCandidate(track);
      }
    }
    console.log(`After track name search: ${candidates.length} candidates`);

    // STRATEGY 6: Fill with broader genre search (but still genre-compatible)
    if (candidates.length < 100 && seedTrack.genres && seedTrack.genres.length > 0) {
      // Use more specific genre searches instead of just "Music"
      const genreSearches = [
        seedTrack.genres[0], // Primary genre
        `${seedTrack.genres[0]} hits`,
        `best ${seedTrack.genres[0]}`,
        `top ${seedTrack.genres[0]} songs`,
      ];
      for (const genreQuery of genreSearches) {
        const fillTracks = await searchAppleMusicTracks(genreQuery, APPLE_MUSIC_LIMIT);
        for (const track of fillTracks) {
          if (candidates.length >= 200) break;
          addCandidate(track); // Genre filter still applies here
        }
      }
    }

    console.log(`Final candidate count: ${candidates.length} (filtered ${genreFilteredCount} by genre)`);
    return candidates;
  } catch (error) {
    console.error("Error generating candidates:", error);
    return candidates;
  }
}

function getAdjacentGenres(genres: string[]): string[] {
  const adjacencyMap: Record<string, string[]> = {
    "pop": ["indie pop", "synth pop", "electropop", "dance pop"],
    "rock": ["indie rock", "alternative", "punk", "grunge"],
    "hip-hop": ["r&b", "trap", "rap", "soul"],
    "r&b": ["soul", "neo-soul", "hip-hop", "funk"],
    "electronic": ["house", "techno", "ambient", "synth"],
    "indie": ["alternative", "folk", "indie rock", "indie pop"],
    "jazz": ["soul", "blues", "funk", "neo-soul"],
    "folk": ["acoustic", "indie folk", "country", "americana"],
    "alternative": ["indie", "rock", "grunge", "post-punk"],
    "soul": ["r&b", "funk", "neo-soul", "gospel"]
  };

  const adjacent: string[] = [];
  for (const genre of genres) {
    const lowerGenre = genre.toLowerCase();
    for (const [key, values] of Object.entries(adjacencyMap)) {
      if (lowerGenre.includes(key)) {
        adjacent.push(...values);
      }
    }
  }
  return [...new Set(adjacent)];
}

// ============================================================================
// SCORING & RANKING
// ============================================================================

async function scoreCandidate(
  seed: PairTrack,
  candidate: PairTrack,
  mode: PairingMode,
  promptText: string | undefined,
  userVector: UserTasteVector | null
): Promise<ScoredCandidate> {
  const config = MODE_CONFIG[mode];
  
  const audioSim = computeAudioSimilarity(seed, candidate);
  const textSim = computeTextSimilarity(seed, candidate, promptText);
  const sceneSim = computeSceneSimilarity(seed, candidate);
  const userSim = computeUserVectorSimilarity(candidate, userVector);

  // Weighted total score
  const totalScore = 
    config.audio_weight * audioSim +
    config.text_weight * textSim +
    config.scene_weight * sceneSim;

  // Apply user vector as a multiplier (subtle influence)
  const userMultiplier = userVector && userVector.positive_count >= 3 
    ? 0.9 + (userSim * 0.2) // Range: 0.9 to 1.1
    : 1.0;

  return {
    track: candidate,
    total_score: totalScore * userMultiplier,
    audio_similarity: audioSim,
    text_similarity: textSim,
    scene_similarity: sceneSim,
    user_vector_similarity: userSim
  };
}

// ============================================================================
// 6-TRACK SLOTTING ALGORITHM (Critical)
// ============================================================================

function selectCoreTrack(
  candidates: ScoredCandidate[],
  selectedArtists: Set<string>,
  selectedIds: Set<string>,
  threshold: number
): ScoredCandidate | null {
  // Find highest scoring candidate that:
  // 1. Meets the threshold
  // 2. Is from a different artist than already selected
  // 3. Hasn't been selected yet
  
  for (const candidate of candidates) {
    if (selectedIds.has(candidate.track.apple_music_id)) continue;
    if (candidate.total_score < threshold) continue;
    
    const artist = candidate.track.artist_name.toLowerCase();
    if (selectedArtists.has(artist)) continue;
    
    return candidate;
  }
  
  // Fallback: relax threshold but still require minimum score of 0.4
  // This prevents completely unrelated tracks from being selected
  const minimumScore = 0.4;
  for (const candidate of candidates) {
    if (selectedIds.has(candidate.track.apple_music_id)) continue;
    if (candidate.total_score < minimumScore) continue; // Hard minimum
    
    const artist = candidate.track.artist_name.toLowerCase();
    if (selectedArtists.has(artist)) continue;
    
    return candidate;
  }
  
  return null;
}

function selectFlavorTrack(
  candidates: ScoredCandidate[],
  selectedArtists: Set<string>,
  selectedIds: Set<string>,
  selectedGenres: Set<string>,
  threshold: number,
  seedGenres?: string[]
): ScoredCandidate | null {
  // Find best candidate that increases variety:
  // 1. Different artist
  // 2. Still within same genre family (important!)
  // 3. Preferably different sub-genre/era
  // 4. Still meets flavor threshold
  
  let bestCandidate: ScoredCandidate | null = null;
  let bestVarietyScore = -1;
  
  for (const candidate of candidates) {
    if (selectedIds.has(candidate.track.apple_music_id)) continue;
    if (candidate.total_score < threshold * 0.8) continue; // Slightly relaxed threshold
    
    const artist = candidate.track.artist_name.toLowerCase();
    if (selectedArtists.has(artist)) continue;
    
    // IMPORTANT: Ensure genre compatibility with seed
    if (seedGenres && !areGenresCompatible(seedGenres, candidate.track.genres)) {
      continue;
    }
    
    // Calculate variety score
    let varietyScore = candidate.total_score;
    
    // Bonus for different sub-genres (within the same family)
    const candidateGenres = candidate.track.genres || [];
    const newGenres = candidateGenres.filter(g => !selectedGenres.has(g.toLowerCase()));
    varietyScore += newGenres.length * 0.05;
    
    // Bonus for different era (if we can determine it)
    // This is a simplified heuristic
    
    if (varietyScore > bestVarietyScore) {
      bestVarietyScore = varietyScore;
      bestCandidate = candidate;
    }
  }
  
  return bestCandidate;
}

function selectWildcard(
  candidates: ScoredCandidate[],
  selectedArtists: Set<string>,
  selectedIds: Set<string>,
  mode: PairingMode,
  seedGenres?: string[]
): ScoredCandidate | null {
  const config = MODE_CONFIG[mode];
  
  // For adventure mode: find track in the "sweet spot" similarity band
  if (mode === "adventure" && config.wildcard_min && config.wildcard_max) {
    for (const candidate of candidates) {
      if (selectedIds.has(candidate.track.apple_music_id)) continue;
      
      const artist = candidate.track.artist_name.toLowerCase();
      if (selectedArtists.has(artist)) continue;
      
      // IMPORTANT: Ensure genre compatibility even for wildcard
      if (seedGenres && !areGenresCompatible(seedGenres, candidate.track.genres)) {
        continue;
      }
      
      // Check if in the similarity band
      if (candidate.total_score >= config.wildcard_min && 
          candidate.total_score <= config.wildcard_max) {
        return candidate;
      }
    }
  }
  
  // For other modes: "stretch but safe" - lower similarity but still coherent
  // Find a track that's different but not too different
  const targetScore = 0.55; // Sweet spot for wildcard
  let bestCandidate: ScoredCandidate | null = null;
  let bestDiff = Infinity;
  
  for (const candidate of candidates) {
    if (selectedIds.has(candidate.track.apple_music_id)) continue;
    
    const artist = candidate.track.artist_name.toLowerCase();
    if (selectedArtists.has(artist)) continue;
    
    // IMPORTANT: Ensure genre compatibility even for wildcard
    if (seedGenres && !areGenresCompatible(seedGenres, candidate.track.genres)) {
      continue;
    }
    
    const diff = Math.abs(candidate.total_score - targetScore);
    if (diff < bestDiff && candidate.total_score >= 0.45) {
      bestDiff = diff;
      bestCandidate = candidate;
    }
  }
  
  return bestCandidate;
}

function generateExplanation(
  candidate: ScoredCandidate,
  slotType: SlotType,
  mode: PairingMode
): string {
  const { audio_similarity, text_similarity, scene_similarity } = candidate;
  
  const explanations = {
    core: {
      high_audio: ["Similar tempo and production", "Matching sonic texture", "Same rhythmic DNA"],
      high_text: ["Captures the same mood", "Shares that emotional tone", "Hits the same way"],
      high_scene: ["From the same musical world", "Adjacent artist circle", "Same era energy"]
    },
    flavor: {
      variety: ["Adds texture to the mix", "Brings fresh perspective", "Expands the palette"],
      genre: ["Genre-crossing connection", "Bridges musical worlds", "Unexpected but fitting"]
    },
    wildcard: {
      adventure: ["Stretch pick: new territory", "Controlled exploration", "Discovery moment"],
      safe: ["Subtle departure", "Gentle stretch", "Familiar but fresh"]
    }
  };

  if (slotType === "core") {
    if (audio_similarity > text_similarity && audio_similarity > scene_similarity) {
      return explanations.core.high_audio[Math.floor(Math.random() * 3)];
    } else if (text_similarity > scene_similarity) {
      return explanations.core.high_text[Math.floor(Math.random() * 3)];
    } else {
      return explanations.core.high_scene[Math.floor(Math.random() * 3)];
    }
  } else if (slotType === "flavor") {
    return explanations.flavor.variety[Math.floor(Math.random() * 3)];
  } else {
    return mode === "adventure" 
      ? explanations.wildcard.adventure[Math.floor(Math.random() * 3)]
      : explanations.wildcard.safe[Math.floor(Math.random() * 3)];
  }
}

// ============================================================================
// MAIN PAIRING FUNCTION
// ============================================================================

export async function generatePairing(input: PairingInput): Promise<PairingResult> {
  const { seed_track_apple_id, prompt_text, mode, user_id } = input;
  const session_id = input.session_id || `session_${Date.now()}`;
  
  console.log(`\n========================================`);
  console.log(`Generating ${mode} pairing for seed: ${seed_track_apple_id}`);
  console.log(`========================================\n`);

  // Get seed track
  const seedTrack = await getAppleMusicTrack(seed_track_apple_id);
  if (!seedTrack) {
    throw new Error(`Seed track not found: ${seed_track_apple_id}`);
  }
  console.log(`Seed: ${seedTrack.track_name} by ${seedTrack.artist_name}`);
  console.log(`Seed genres: ${seedTrack.genres?.join(", ") || "NONE"}`);
  console.log(`Seed release date: ${seedTrack.release_date || "UNKNOWN"}`);

  // Get exclusion sets
  const exclusions = await getExclusionSets(user_id || "", session_id);
  const excludedCount = 
    exclusions.owned_tracks.size + 
    exclusions.disliked_tracks.size + 
    exclusions.session_tracks.size +
    exclusions.recent_tracks.size;
  console.log(`Exclusions: ${excludedCount} tracks`);

  // Get user taste vector
  const userVector = await getUserTasteVector(user_id || "");
  console.log(`User vector: ${userVector ? `${userVector.positive_count} positive events` : "none"}`);

  // Generate candidates (200-500)
  let candidates = await generateCandidates(seedTrack, exclusions, mode);
  console.log(`Generated ${candidates.length} candidates`);

  // If no candidates, try again with relaxed genre filter (adventure mode)
  if (candidates.length === 0) {
    console.log("No candidates found, retrying with relaxed genre filter...");
    candidates = await generateCandidates(seedTrack, exclusions, "adventure");
    console.log(`Retry generated ${candidates.length} candidates`);
  }

  if (candidates.length === 0) {
    // Last resort: search for the seed artist's tracks directly
    const sanitizedArtist = sanitizeSearchQuery(seedTrack.artist_name);
    console.log("Still no candidates, searching for seed artist tracks...");
    console.log(`Searching for: "${sanitizedArtist}" (original: "${seedTrack.artist_name}")`);
    const artistTracks = await searchAppleMusicTracks(sanitizedArtist, 25);
    for (const track of artistTracks) {
      if (track.apple_music_id !== seedTrack.apple_music_id) {
        candidates.push(track);
      }
    }
    console.log(`Artist search found ${candidates.length} candidates`);
  }

  if (candidates.length === 0) {
    throw new Error("No candidates available after all fallback strategies");
  }

  // Score all candidates
  console.log(`Scoring candidates...`);
  const scoredCandidates: ScoredCandidate[] = [];
  for (const candidate of candidates) {
    const scored = await scoreCandidate(seedTrack, candidate, mode, prompt_text, userVector);
    scoredCandidates.push(scored);
  }

  // Sort by total score
  scoredCandidates.sort((a, b) => b.total_score - a.total_score);
  console.log(`Top score: ${scoredCandidates[0]?.total_score.toFixed(3)}`);

  // ========================================
  // 6-TRACK SLOTTING
  // ========================================
  const config = MODE_CONFIG[mode];
  const selectedTracks: SlottedTrack[] = [];
  const selectedArtists = new Set<string>();
  const selectedIds = new Set<string>();
  const selectedGenres = new Set<string>();

  // Add seed artist to prevent same-artist recommendations
  selectedArtists.add(seedTrack.artist_name.toLowerCase());

  // SLOT 1-3: Core tracks (trust builders)
  console.log(`\nSelecting Core tracks (threshold: ${config.core_threshold})...`);
  for (let i = 0; i < 3; i++) {
    const core = selectCoreTrack(
      scoredCandidates, 
      selectedArtists, 
      selectedIds, 
      config.core_threshold
    );
    
    if (core) {
      selectedTracks.push({
        track: core.track,
        slot_type: "core",
        slot_position: i + 1,
        similarity_score: core.total_score,
        audio_similarity: core.audio_similarity,
        text_similarity: core.text_similarity,
        scene_similarity: core.scene_similarity,
        explanation: generateExplanation(core, "core", mode)
      });
      
      selectedArtists.add(core.track.artist_name.toLowerCase());
      selectedIds.add(core.track.apple_music_id);
      core.track.genres?.forEach(g => selectedGenres.add(g.toLowerCase()));
      
      console.log(`  Core ${i + 1}: ${core.track.track_name} (${core.total_score.toFixed(3)})`);
    }
  }

  // SLOT 4-5: Flavor tracks (variety within coherence)
  console.log(`\nSelecting Flavor tracks (threshold: ${config.flavor_threshold})...`);
  for (let i = 0; i < 2; i++) {
    const flavor = selectFlavorTrack(
      scoredCandidates,
      selectedArtists,
      selectedIds,
      selectedGenres,
      config.flavor_threshold,
      seedTrack.genres // Pass seed genres to enforce genre compatibility
    );
    
    if (flavor) {
      selectedTracks.push({
        track: flavor.track,
        slot_type: "flavor",
        slot_position: 4 + i,
        similarity_score: flavor.total_score,
        audio_similarity: flavor.audio_similarity,
        text_similarity: flavor.text_similarity,
        scene_similarity: flavor.scene_similarity,
        explanation: generateExplanation(flavor, "flavor", mode)
      });
      
      selectedArtists.add(flavor.track.artist_name.toLowerCase());
      selectedIds.add(flavor.track.apple_music_id);
      flavor.track.genres?.forEach(g => selectedGenres.add(g.toLowerCase()));
      
      console.log(`  Flavor ${i + 1}: ${flavor.track.track_name} (${flavor.total_score.toFixed(3)})`);
    }
  }

  // SLOT 6: Wildcard (controlled stretch)
  console.log(`\nSelecting Wildcard track...`);
  const wildcard = selectWildcard(scoredCandidates, selectedArtists, selectedIds, mode, seedTrack.genres);
  
  if (wildcard) {
    selectedTracks.push({
      track: wildcard.track,
      slot_type: "wildcard",
      slot_position: 6,
      similarity_score: wildcard.total_score,
      audio_similarity: wildcard.audio_similarity,
      text_similarity: wildcard.text_similarity,
      scene_similarity: wildcard.scene_similarity,
      explanation: generateExplanation(wildcard, "wildcard", mode)
    });
    
    console.log(`  Wildcard: ${wildcard.track.track_name} (${wildcard.total_score.toFixed(3)})`);
  }

  // Verify artist diversity (min 4 unique artists in 6 tracks)
  const uniqueArtists = new Set(selectedTracks.map(t => t.track.artist_name.toLowerCase()));
  console.log(`\nArtist diversity: ${uniqueArtists.size} unique artists`);
  
  if (uniqueArtists.size < 4 && selectedTracks.length >= 6) {
    console.warn("Warning: Less than 4 unique artists in selection");
  }

  console.log(`\n========================================`);
  console.log(`Final selection: ${selectedTracks.length} tracks`);
  console.log(`========================================\n`);

  return {
    tracks: selectedTracks,
    seed_track: seedTrack,
    mode,
    session_id,
    excluded_count: excludedCount
  };
}

// ============================================================================
// USER INTERACTION LOGGING
// ============================================================================

export async function logPairingInteraction(
  pairingHistoryId: string,
  userId: string,
  interactionType: string,
  durationMs?: number
): Promise<void> {
  try {
    await supabase.from("pairing_interactions").insert({
      pairing_history_id: pairingHistoryId,
      user_id: userId,
      interaction_type: interactionType,
      duration_ms: durationMs
    });

    // Update taste vector if this is a significant interaction
    if (["liked", "saved", "added_to_playlist"].includes(interactionType)) {
      await updateTasteVectorFromInteraction(userId, pairingHistoryId, true);
    } else if (interactionType === "disliked") {
      await updateTasteVectorFromInteraction(userId, pairingHistoryId, false);
    }
  } catch (error) {
    console.error("Error logging pairing interaction:", error);
  }
}

async function updateTasteVectorFromInteraction(
  userId: string,
  pairingHistoryId: string,
  isPositive: boolean
): Promise<void> {
  try {
    // Get the track from pairing history
    const { data: history } = await supabase
      .from("pairing_history")
      .select("recommended_track_id, pair_tracks(*)")
      .eq("id", pairingHistoryId)
      .single();

    if (!history) return;

    const trackData = history.pair_tracks as unknown;
    const track = (Array.isArray(trackData) ? trackData[0] : trackData) as PairTrack | null;
    if (!track) return;

    // Get current taste vector
    const { data: currentVector } = await supabase
      .from("user_taste_vectors")
      .select("*")
      .eq("user_id", userId)
      .single();

    // Calculate new averages
    const positiveCount = (currentVector?.positive_track_count || 0) + (isPositive ? 1 : 0);
    const negativeCount = (currentVector?.negative_track_count || 0) + (isPositive ? 0 : 1);
    
    if (isPositive) {
      // Update preferred features towards this track
      const alpha = 1 / positiveCount; // Learning rate decreases as we get more data
      
      const newVector = {
        user_id: userId,
        preferred_energy: lerp(currentVector?.preferred_energy || 0.5, track.energy || 0.5, alpha),
        preferred_valence: lerp(currentVector?.preferred_valence || 0.5, track.valence || 0.5, alpha),
        preferred_danceability: lerp(currentVector?.preferred_danceability || 0.5, track.danceability || 0.5, alpha),
        preferred_acousticness: lerp(currentVector?.preferred_acousticness || 0.5, track.acousticness || 0.5, alpha),
        preferred_instrumentalness: lerp(currentVector?.preferred_instrumentalness || 0.5, track.instrumentalness || 0.5, alpha),
        preferred_tempo: lerp(currentVector?.preferred_tempo || 120, track.tempo || 120, alpha),
        positive_track_count: positiveCount,
        negative_track_count: negativeCount,
        computed_at: new Date().toISOString()
      };

      await supabase.from("user_taste_vectors").upsert(newVector);
    }

    // If disliked, add to permanent exclusion list
    if (!isPositive) {
      await supabase.from("user_disliked_tracks").upsert({
        user_id: userId,
        track_id: history.recommended_track_id,
        apple_music_id: track.apple_music_id
      });
    }
  } catch (error) {
    console.error("Error updating taste vector:", error);
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ============================================================================
// SAVE PAIRING TO HISTORY
// ============================================================================

export async function savePairingToHistory(
  result: PairingResult,
  userId: string
): Promise<void> {
  try {
    // Generate a unique pairing_set_id for this batch of 6 tracks
    const pairingSetId = crypto.randomUUID();
    
    for (const slottedTrack of result.tracks) {
      // Ensure track exists in pair_tracks
      let { data: pairTrack } = await supabase
        .from("pair_tracks")
        .select("id")
        .eq("apple_music_id", slottedTrack.track.apple_music_id)
        .single();

      if (!pairTrack) {
        const { data: newTrack } = await supabase
          .from("pair_tracks")
          .insert({
            apple_music_id: slottedTrack.track.apple_music_id,
            track_name: slottedTrack.track.track_name,
            artist_name: slottedTrack.track.artist_name,
            album_name: slottedTrack.track.album_name,
            album_art_url: slottedTrack.track.album_art_url,
            preview_url: slottedTrack.track.preview_url,
            duration_ms: slottedTrack.track.duration_ms,
            genres: slottedTrack.track.genres,
            energy: slottedTrack.track.energy,
            valence: slottedTrack.track.valence,
            danceability: slottedTrack.track.danceability,
            acousticness: slottedTrack.track.acousticness,
            instrumentalness: slottedTrack.track.instrumentalness,
            tempo: slottedTrack.track.tempo
          })
          .select("id")
          .single();
        pairTrack = newTrack;
      }

      // Get seed track id
      let { data: seedPairTrack } = await supabase
        .from("pair_tracks")
        .select("id")
        .eq("apple_music_id", result.seed_track.apple_music_id)
        .single();

      if (!seedPairTrack) {
        const { data: newSeedTrack } = await supabase
          .from("pair_tracks")
          .insert({
            apple_music_id: result.seed_track.apple_music_id,
            track_name: result.seed_track.track_name,
            artist_name: result.seed_track.artist_name,
            album_name: result.seed_track.album_name,
            album_art_url: result.seed_track.album_art_url,
            preview_url: result.seed_track.preview_url,
            duration_ms: result.seed_track.duration_ms,
            genres: result.seed_track.genres
          })
          .select("id")
          .single();
        seedPairTrack = newSeedTrack;
      }

      if (pairTrack && seedPairTrack) {
        await supabase.from("pairing_history").insert({
          user_id: userId,
          session_id: result.session_id,
          pairing_set_id: pairingSetId,
          seed_track_id: seedPairTrack.id,
          recommended_track_id: pairTrack.id,
          slot_type: slottedTrack.slot_type,
          slot_position: slottedTrack.slot_position,
          mode: result.mode,
          similarity_score: slottedTrack.similarity_score,
          audio_similarity: slottedTrack.audio_similarity,
          text_similarity: slottedTrack.text_similarity,
          scene_similarity: slottedTrack.scene_similarity,
          explanation: slottedTrack.explanation
        });
      }
    }
  } catch (error) {
    console.error("Error saving pairing to history:", error);
  }
}
