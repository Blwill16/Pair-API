// Pair Brain - Recommendation Engine with No-Recycling Constraint
// Pair owns taste. Apple Music is only the library + playback layer.
// No third-party recommendation dependencies.

import { PairTrack, getMockCandidates, getAppleMusicTrack, getAppleMusicRelatedTracks } from "./appleMusic";
import { getVibeSimilarity } from "./embeddings";
import { supabase } from "./supabase";

export type PairingMode = "same_sound" | "same_vibe" | "same_scene" | "adventure";

// Event types for user behavior tracking
export type UserEventType = 
  | "preview_play"      // Started preview (>10s counts as engagement)
  | "full_preview_play" // Completed full preview
  | "swipe_like"        // Swiped right / liked
  | "swipe_dislike"     // Swiped left / disliked
  | "add_to_playlist"   // Added to a playlist
  | "skip_fast"         // Skipped quickly (<2s)
  | "save"              // Saved track
  | "view";             // Viewed but no action

interface RecommendationInput {
  seed_track_apple_id: string;
  prompt_text: string;
  mode: PairingMode;
  user_id?: string;
  limit?: number;
}

interface ScoredCandidate {
  track: PairTrack;
  score: number;
  reason: string;
  sound_similarity: number;
  vibe_similarity: number;
  user_vector_similarity?: number;
  diversity_penalty?: number;
  novelty_bonus?: number;
}

interface RecommendationResult {
  candidates: ScoredCandidate[];
  seed_track: PairTrack;
  filtered_count: number;
}

// User taste vector computed from behavior
interface UserTasteVector {
  energy: number;
  valence: number;
  danceability: number;
  acousticness: number;
  instrumentalness: number;
  tempo: number;
  preferred_genres: string[];
  positive_count: number;
  negative_count: number;
}

// Exclusion sets for no-recycling rule
interface ExclusionSets {
  playlist_tracks: Set<string>;  // Never show again
  disliked_tracks: Set<string>;  // Never show again
  seen_tracks: Map<string, Date>; // Cooldown 7-30 days
}

// Mode-specific weights for ranking
// Each mode should feel meaningfully different
const MODE_WEIGHTS: Record<PairingMode, { 
  seed_similarity: number; 
  user_vector: number; 
  vibe: number;
  novelty: number;
  diversity: number;
}> = {
  // Same Sound: Tight similarity to seed track, same artist adjacency
  same_sound: { 
    seed_similarity: 0.55, 
    user_vector: 0.15, 
    vibe: 0.15, 
    novelty: 0.05,
    diversity: 0.10 
  },
  // Same Vibe: Driven by prompt language, mood > genre, can cross genres
  same_vibe: { 
    seed_similarity: 0.25, 
    user_vector: 0.20, 
    vibe: 0.40, 
    novelty: 0.05,
    diversity: 0.10 
  },
  // Same Scene: Artist graph expansion, prioritize non-obvious artists
  same_scene: { 
    seed_similarity: 0.30, 
    user_vector: 0.15, 
    vibe: 0.20, 
    novelty: 0.20,
    diversity: 0.15 
  },
  // Adventure: 70% close to user_vector, 30% adjacent clusters
  adventure: { 
    seed_similarity: 0.15, 
    user_vector: 0.45, 
    vibe: 0.15, 
    novelty: 0.15,
    diversity: 0.10 
  },
};

// Cooldown period in days for seen-but-ignored tracks
const COOLDOWN_DAYS = 14;

function computeSoundSimilarity(seed: PairTrack, candidate: PairTrack): number {
  const features = ["energy", "valence", "danceability", "acousticness", "instrumentalness", "tempo"] as const;
  
  let dotProduct = 0;
  let normSeed = 0;
  let normCandidate = 0;
  
  for (const feature of features) {
    const seedVal = seed[feature] ?? 0.5;
    const candidateVal = candidate[feature] ?? 0.5;
    
    // Normalize tempo to 0-1 range
    const normalizedSeed = feature === "tempo" ? Math.min(1, seedVal / 200) : seedVal;
    const normalizedCandidate = feature === "tempo" ? Math.min(1, candidateVal / 200) : candidateVal;
    
    dotProduct += normalizedSeed * normalizedCandidate;
    normSeed += normalizedSeed * normalizedSeed;
    normCandidate += normalizedCandidate * normalizedCandidate;
  }
  
  if (normSeed === 0 || normCandidate === 0) return 0;
  return dotProduct / (Math.sqrt(normSeed) * Math.sqrt(normCandidate));
}

function computeNoveltyScore(soundSimilarity: number, mode: PairingMode): number {
  if (mode === "adventure") {
    // Sweet spot: not too similar, not too different
    if (soundSimilarity >= 0.55 && soundSimilarity <= 0.80) return 1.0;
    if (soundSimilarity < 0.55) return 0.3;
    return 0.6;
  }
  return Math.max(0, Math.min(1, 1 - soundSimilarity));
}

function generateReason(
  seed: PairTrack,
  candidate: PairTrack,
  soundSimilarity: number,
  vibeSimilarity: number,
  mode: PairingMode
): string {
  const descriptors = {
    energy: ["driving intensity", "electric feel", "raw power"],
    valence: ["emotional tone", "uplifting spirit", "introspective feel"],
    danceability: ["infectious rhythm", "body-moving beat", "danceable pulse"],
    acousticness: ["organic texture", "warm tones", "intimate sound"],
    tempo: ["matching rhythm", "smooth pace", "steady flow"],
  };

  const emotionalPhrases = [
    "perfect for the moment",
    "hits the same way",
    "carries that feeling",
    "captures the essence",
  ];

  // Find the most similar feature
  const features = ["energy", "valence", "danceability", "acousticness", "tempo"] as const;
  type FeatureType = typeof features[number];
  let bestFeature: FeatureType = features[0];
  let bestDiff = Infinity;

  for (const feature of features) {
    const seedVal = seed[feature] ?? 0.5;
    const candidateVal = candidate[feature] ?? 0.5;
    const diff = Math.abs(seedVal - candidateVal);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestFeature = feature;
    }
  }

  const descriptor = descriptors[bestFeature][Math.floor(Math.random() * 3)];
  const emotional = emotionalPhrases[Math.floor(Math.random() * emotionalPhrases.length)];

  if (vibeSimilarity > 0.6) {
    return `${descriptor} — ${emotional}`;
  }
  return `Shares that ${descriptor}`;
}

// Get all exclusion sets for a user (no-recycling rule)
async function getExclusionSets(userId: string): Promise<ExclusionSets> {
  const exclusions: ExclusionSets = {
    playlist_tracks: new Set<string>(),
    disliked_tracks: new Set<string>(),
    seen_tracks: new Map<string, Date>(),
  };
  
  if (!userId) return exclusions;

  try {
    // Get tracks from user's playlists (never show again)
    const { data: playlistTracks } = await supabase
      .from("playlist_tracks")
      .select("track_id, playlists!inner(user_id)")
      .eq("playlists.user_id", userId);

    if (playlistTracks) {
      for (const item of playlistTracks) {
        exclusions.playlist_tracks.add(item.track_id);
      }
    }

    // Get disliked tracks (never show again)
    const { data: dislikedEvents } = await supabase
      .from("user_events")
      .select("track_id, pair_tracks(apple_music_id)")
      .eq("user_id", userId)
      .eq("event_type", "swipe_dislike");

    if (dislikedEvents) {
      for (const event of dislikedEvents) {
        const trackData = event.pair_tracks as unknown;
        const pairTrack = (Array.isArray(trackData) ? trackData[0] : trackData) as { apple_music_id: string } | null;
        if (pairTrack?.apple_music_id) {
          exclusions.disliked_tracks.add(pairTrack.apple_music_id);
        }
      }
    }

    // Get seen tracks with timestamps (cooldown period)
    const cooldownDate = new Date();
    cooldownDate.setDate(cooldownDate.getDate() - COOLDOWN_DAYS);
    
    const { data: seenEvents } = await supabase
      .from("user_events")
      .select("track_id, created_at, pair_tracks(apple_music_id)")
      .eq("user_id", userId)
      .in("event_type", ["view", "skip_fast"])
      .gte("created_at", cooldownDate.toISOString());

    if (seenEvents) {
      for (const event of seenEvents) {
        const trackData = event.pair_tracks as unknown;
        const pairTrack = (Array.isArray(trackData) ? trackData[0] : trackData) as { apple_music_id: string } | null;
        if (pairTrack?.apple_music_id) {
          exclusions.seen_tracks.set(pairTrack.apple_music_id, new Date(event.created_at));
        }
      }
    }

    // Also get tracks from user_library with state='owned'
    const { data: libraryTracks } = await supabase
      .from("user_library")
      .select("track_id, pair_tracks(apple_music_id)")
      .eq("user_id", userId)
      .eq("state", "owned");

    if (libraryTracks) {
      for (const item of libraryTracks) {
        const trackData = item.pair_tracks as unknown;
        const pairTrack = (Array.isArray(trackData) ? trackData[0] : trackData) as { apple_music_id: string } | null;
        if (pairTrack?.apple_music_id) {
          exclusions.playlist_tracks.add(pairTrack.apple_music_id);
        }
      }
    }
  } catch (error) {
    console.error("Error fetching exclusion sets:", error);
  }

  return exclusions;
}

// Get user's taste vector from database
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
        preferred_genres: data.preferred_genres || [],
        positive_count: data.positive_track_count || 0,
        negative_count: data.negative_track_count || 0,
      };
    }
  } catch {
    // No taste vector yet
  }

  return null;
}

// Compute similarity between a track and user's taste vector
function computeUserVectorSimilarity(track: PairTrack, userVector: UserTasteVector | null): number {
  if (!userVector || userVector.positive_count < 3) {
    // Not enough data to compute meaningful similarity
    return 0.5;
  }

  const features = ["energy", "valence", "danceability", "acousticness", "instrumentalness"] as const;
  let dotProduct = 0;
  let normTrack = 0;
  let normUser = 0;

  for (const feature of features) {
    const trackVal = track[feature] ?? 0.5;
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

// Check if track should be excluded
function shouldExclude(trackId: string, exclusions: ExclusionSets): boolean {
  // Never show tracks in playlists
  if (exclusions.playlist_tracks.has(trackId)) return true;
  
  // Never show disliked tracks
  if (exclusions.disliked_tracks.has(trackId)) return true;
  
  // Check cooldown for seen tracks
  if (exclusions.seen_tracks.has(trackId)) return true;
  
  return false;
}

// Compute diversity penalty based on artist repetition
function computeDiversityPenalty(
  track: PairTrack, 
  artistCounts: Map<string, number>,
  seedArtist: string
): number {
  const artist = track.artist_name.toLowerCase();
  const count = artistCounts.get(artist) || 0;
  
  // Same artist as seed gets a penalty
  if (artist === seedArtist.toLowerCase()) {
    return 0.7; // 30% penalty
  }
  
  // Repeated artists get increasing penalties
  if (count >= 2) return 0.5;
  if (count >= 1) return 0.8;
  return 1.0;
}

// Compute novelty bonus for non-obvious tracks
function computeNoveltyBonus(track: PairTrack, mode: PairingMode): number {
  // For adventure mode, prefer less popular/obvious tracks
  if (mode === "adventure") {
    // Tracks with longer names or less common artists get a bonus
    const nameLength = track.track_name.length;
    if (nameLength > 20) return 1.1;
    return 1.0;
  }
  
  // For same_scene, prefer non-top-hits
  if (mode === "same_scene") {
    return 1.05;
  }
  
  return 1.0;
}

export async function generateRecommendations(
  input: RecommendationInput
): Promise<RecommendationResult> {
  const { seed_track_apple_id, prompt_text, mode, user_id, limit = 20 } = input;

  console.log(`Generating ${mode} recommendations for seed: ${seed_track_apple_id}`);

  // Get seed track
  const seedTrack = await getAppleMusicTrack(seed_track_apple_id);
  if (!seedTrack) {
    throw new Error(`Seed track not found: ${seed_track_apple_id}`);
  }

  // Get exclusion sets for no-recycling rule
  const exclusions = await getExclusionSets(user_id || "");
  const totalExcluded = exclusions.playlist_tracks.size + exclusions.disliked_tracks.size + exclusions.seen_tracks.size;
  console.log(`Exclusion sets: ${totalExcluded} tracks excluded`);

  // Get user's taste vector
  const userVector = await getUserTasteVector(user_id || "");
  console.log(`User taste vector: ${userVector ? `${userVector.positive_count} positive events` : "none"}`);

  // Build exclusion list for candidate generation
  const excludeIds = [
    seed_track_apple_id,
    ...Array.from(exclusions.playlist_tracks),
    ...Array.from(exclusions.disliked_tracks),
    ...Array.from(exclusions.seen_tracks.keys()),
  ];

  // Get candidate tracks from Apple Music (real data, not mock)
  // Request more candidates than needed to account for filtering
  const rawCandidates = await getAppleMusicRelatedTracks(seedTrack, excludeIds, limit * 3);
  console.log(`Got ${rawCandidates.length} raw candidates from Apple Music`);

  // Filter candidates through exclusion rules
  const filteredCandidates = rawCandidates.filter(
    track => !shouldExclude(track.apple_music_id, exclusions)
  );
  console.log(`After exclusion filtering: ${filteredCandidates.length} candidates`);

  // Score each candidate
  const scoredCandidates: ScoredCandidate[] = [];
  const weights = MODE_WEIGHTS[mode];
  const artistCounts = new Map<string, number>();

  for (const candidate of filteredCandidates) {
    // Compute seed similarity (sound features)
    const seedSimilarity = computeSoundSimilarity(seedTrack, candidate);
    
    // Compute user vector similarity
    const userVectorSimilarity = computeUserVectorSimilarity(candidate, userVector);
    
    // Compute vibe similarity using embeddings (prompt-based)
    const seedText = `${seedTrack.track_name} ${seedTrack.artist_name} ${seedTrack.genres?.join(" ") || ""}`;
    const candidateText = `${candidate.track_name} ${candidate.artist_name} ${candidate.genres?.join(" ") || ""}`;
    const vibeSimilarity = await getVibeSimilarity(
      prompt_text || seedText,
      candidateText
    );

    // Compute diversity penalty
    const diversityPenalty = computeDiversityPenalty(candidate, artistCounts, seedTrack.artist_name);
    
    // Compute novelty bonus
    const noveltyBonus = computeNoveltyBonus(candidate, mode);

    // Final score using mode-specific weights
    const finalScore = (
      weights.seed_similarity * seedSimilarity +
      weights.user_vector * userVectorSimilarity +
      weights.vibe * vibeSimilarity +
      weights.novelty * (noveltyBonus - 1) +
      weights.diversity * (diversityPenalty - 1)
    ) * diversityPenalty * noveltyBonus;

    const reason = generateReason(seedTrack, candidate, seedSimilarity, vibeSimilarity, mode);

    scoredCandidates.push({
      track: candidate,
      score: finalScore,
      reason,
      sound_similarity: seedSimilarity,
      vibe_similarity: vibeSimilarity,
      user_vector_similarity: userVectorSimilarity,
      diversity_penalty: diversityPenalty,
      novelty_bonus: noveltyBonus,
    });

    // Track artist counts for diversity
    const artist = candidate.artist_name.toLowerCase();
    artistCounts.set(artist, (artistCounts.get(artist) || 0) + 1);
  }

  // Sort by score
  scoredCandidates.sort((a, b) => b.score - a.score);

  // Apply final diversity rule: max 2 tracks per artist in results
  const finalArtistCounts = new Map<string, number>();
  const diversified: ScoredCandidate[] = [];

  for (const candidate of scoredCandidates) {
    const artist = candidate.track.artist_name.toLowerCase();
    const count = finalArtistCounts.get(artist) || 0;
    
    // For same_sound mode, allow more from same artist
    const maxPerArtist = mode === "same_sound" ? 3 : 2;
    
    if (count < maxPerArtist) {
      diversified.push(candidate);
      finalArtistCounts.set(artist, count + 1);
    }
    if (diversified.length >= limit) break;
  }

  console.log(`Final recommendations: ${diversified.length} tracks`);

  return {
    candidates: diversified,
    seed_track: seedTrack,
    filtered_count: totalExcluded,
  };
}

// Log user event
export async function logUserEvent(
  userId: string,
  trackAppleMusicId: string,
  eventType: string,
  context?: string,
  sessionId?: string,
  durationMs?: number
): Promise<void> {
  try {
    // First, ensure the track exists in pair_tracks
    let { data: pairTrack } = await supabase
      .from("pair_tracks")
      .select("id")
      .eq("apple_music_id", trackAppleMusicId)
      .single();

    if (!pairTrack) {
      // Create the track if it doesn't exist
      const trackData = await getAppleMusicTrack(trackAppleMusicId);
      if (trackData) {
        const { data: newTrack } = await supabase
          .from("pair_tracks")
          .insert({
            apple_music_id: trackAppleMusicId,
            track_name: trackData.track_name,
            artist_name: trackData.artist_name,
            album_name: trackData.album_name,
            album_art_url: trackData.album_art_url,
            preview_url: trackData.preview_url,
            duration_ms: trackData.duration_ms,
            genres: trackData.genres,
            energy: trackData.energy,
            valence: trackData.valence,
            danceability: trackData.danceability,
            acousticness: trackData.acousticness,
            instrumentalness: trackData.instrumentalness,
            tempo: trackData.tempo,
          })
          .select("id")
          .single();
        pairTrack = newTrack;
      }
    }

    if (!pairTrack) {
      console.error("Could not find or create pair_track for:", trackAppleMusicId);
      return;
    }

    // Log the event
    await supabase.from("user_events").insert({
      user_id: userId,
      track_id: pairTrack.id,
      event_type: eventType,
      context,
      session_id: sessionId,
      duration_ms: durationMs,
    });
  } catch (error) {
    console.error("Error logging user event:", error);
  }
}

// Add track to user library (marks as owned - will be filtered from discovery)
export async function addToUserLibrary(
  userId: string,
  trackAppleMusicId: string,
  source: string = "discovery"
): Promise<void> {
  try {
    // Ensure track exists in pair_tracks
    let { data: pairTrack } = await supabase
      .from("pair_tracks")
      .select("id")
      .eq("apple_music_id", trackAppleMusicId)
      .single();

    if (!pairTrack) {
      const trackData = await getAppleMusicTrack(trackAppleMusicId);
      if (trackData) {
        const { data: newTrack } = await supabase
          .from("pair_tracks")
          .insert({
            apple_music_id: trackAppleMusicId,
            track_name: trackData.track_name,
            artist_name: trackData.artist_name,
            album_name: trackData.album_name,
            album_art_url: trackData.album_art_url,
            preview_url: trackData.preview_url,
            duration_ms: trackData.duration_ms,
            genres: trackData.genres,
            energy: trackData.energy,
            valence: trackData.valence,
            danceability: trackData.danceability,
            acousticness: trackData.acousticness,
            instrumentalness: trackData.instrumentalness,
            tempo: trackData.tempo,
          })
          .select("id")
          .single();
        pairTrack = newTrack;
      }
    }

    if (!pairTrack) {
      throw new Error("Could not find or create track");
    }

    // Add to user library with state='owned'
    await supabase.from("user_library").upsert({
      user_id: userId,
      track_id: pairTrack.id,
      state: "owned",
      source,
    });

    // Also log the save event
    await logUserEvent(userId, trackAppleMusicId, "save", source);
  } catch (error) {
    console.error("Error adding to user library:", error);
    throw error;
  }
}

// Compute user taste vector from events
export async function computeTasteVector(userId: string): Promise<void> {
  try {
    // Get positive events (like, save, preview_complete)
    const { data: positiveEvents } = await supabase
      .from("user_events")
      .select(`
        track_id,
        pair_tracks (
          energy, valence, danceability, acousticness, instrumentalness, tempo
        )
      `)
      .eq("user_id", userId)
      .in("event_type", ["like", "save", "preview_complete"]);

    // Get negative events (skip)
    const { data: negativeEvents } = await supabase
      .from("user_events")
      .select("track_id")
      .eq("user_id", userId)
      .eq("event_type", "skip");

    if (!positiveEvents || positiveEvents.length === 0) {
      return;
    }

    // Compute average features from positive events
    const features = {
      energy: 0,
      valence: 0,
      danceability: 0,
      acousticness: 0,
      instrumentalness: 0,
      tempo: 0,
    };
    let count = 0;

    for (const event of positiveEvents) {
      const trackData = event.pair_tracks as unknown;
      const track = (Array.isArray(trackData) ? trackData[0] : trackData) as {
        energy: number;
        valence: number;
        danceability: number;
        acousticness: number;
        instrumentalness: number;
        tempo: number;
      } | null;
      
      if (track) {
        features.energy += track.energy || 0;
        features.valence += track.valence || 0;
        features.danceability += track.danceability || 0;
        features.acousticness += track.acousticness || 0;
        features.instrumentalness += track.instrumentalness || 0;
        features.tempo += track.tempo || 0;
        count++;
      }
    }

    if (count > 0) {
      features.energy /= count;
      features.valence /= count;
      features.danceability /= count;
      features.acousticness /= count;
      features.instrumentalness /= count;
      features.tempo /= count;
    }

    // Upsert taste vector
    await supabase.from("user_taste_vectors").upsert({
      user_id: userId,
      preferred_energy: features.energy,
      preferred_valence: features.valence,
      preferred_danceability: features.danceability,
      preferred_acousticness: features.acousticness,
      preferred_instrumentalness: features.instrumentalness,
      preferred_tempo: features.tempo,
      positive_track_count: positiveEvents.length,
      negative_track_count: negativeEvents?.length || 0,
      computed_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error computing taste vector:", error);
  }
}
