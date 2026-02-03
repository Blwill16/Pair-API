// Pair Brain - Recommendation Engine with No-Recycling Constraint
// Uses Apple Music IDs and taste vectors for personalized recommendations

import { PairTrack, getMockCandidates, getAppleMusicTrack } from "./appleMusic";
import { getVibeSimilarity } from "./embeddings";
import { supabase } from "./supabase";

export type PairingMode = "same_sound" | "same_vibe" | "same_scene" | "adventure";

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
}

interface RecommendationResult {
  candidates: ScoredCandidate[];
  seed_track: PairTrack;
  filtered_count: number;
}

const MODE_WEIGHTS: Record<PairingMode, { sound: number; vibe: number; novelty: number }> = {
  same_sound: { sound: 0.70, vibe: 0.20, novelty: 0.10 },
  same_vibe: { sound: 0.40, vibe: 0.45, novelty: 0.15 },
  same_scene: { sound: 0.35, vibe: 0.35, novelty: 0.30 },
  adventure: { sound: 0.30, vibe: 0.35, novelty: 0.35 },
};

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

async function getOwnedTrackIds(userId: string): Promise<Set<string>> {
  const ownedIds = new Set<string>();
  
  try {
    // Get tracks from user_library with state='owned'
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
          ownedIds.add(pairTrack.apple_music_id);
        }
      }
    }

    // Also check saved_tracks table for backwards compatibility
    const { data: savedTracks } = await supabase
      .from("saved_tracks")
      .select("track_id")
      .eq("user_id", userId);

    if (savedTracks) {
      for (const track of savedTracks) {
        ownedIds.add(track.track_id);
      }
    }
  } catch (error) {
    console.error("Error fetching owned tracks:", error);
  }

  return ownedIds;
}

export async function generateRecommendations(
  input: RecommendationInput
): Promise<RecommendationResult> {
  const { seed_track_apple_id, prompt_text, mode, user_id, limit = 20 } = input;

  // Get seed track
  const seedTrack = await getAppleMusicTrack(seed_track_apple_id);
  if (!seedTrack) {
    throw new Error(`Seed track not found: ${seed_track_apple_id}`);
  }

  // Get owned track IDs for no-recycling filter
  const ownedTrackIds = user_id ? await getOwnedTrackIds(user_id) : new Set<string>();
  
  // Get candidate tracks (excluding seed and owned tracks)
  const excludeIds = [seed_track_apple_id, ...Array.from(ownedTrackIds)];
  const candidates = getMockCandidates(excludeIds);

  // Score each candidate
  const scoredCandidates: ScoredCandidate[] = [];
  const weights = MODE_WEIGHTS[mode];

  for (const candidate of candidates) {
    const soundSimilarity = computeSoundSimilarity(seedTrack, candidate);
    
    // Compute vibe similarity using embeddings
    const seedText = `${seedTrack.track_name} ${seedTrack.artist_name} ${seedTrack.genres?.join(" ") || ""}`;
    const candidateText = `${candidate.track_name} ${candidate.artist_name} ${candidate.genres?.join(" ") || ""}`;
    const vibeSimilarity = await getVibeSimilarity(
      prompt_text || seedText,
      candidateText
    );

    const noveltyScore = computeNoveltyScore(soundSimilarity, mode);

    const finalScore =
      weights.sound * soundSimilarity +
      weights.vibe * vibeSimilarity +
      weights.novelty * noveltyScore;

    const reason = generateReason(seedTrack, candidate, soundSimilarity, vibeSimilarity, mode);

    scoredCandidates.push({
      track: candidate,
      score: finalScore,
      reason,
      sound_similarity: soundSimilarity,
      vibe_similarity: vibeSimilarity,
    });
  }

  // Sort by score and take top N
  scoredCandidates.sort((a, b) => b.score - a.score);

  // Apply diversity rule: max 2 tracks per artist
  const artistCounts = new Map<string, number>();
  const diversified: ScoredCandidate[] = [];

  for (const candidate of scoredCandidates) {
    const artist = candidate.track.artist_name;
    const count = artistCounts.get(artist) || 0;
    if (count < 2) {
      diversified.push(candidate);
      artistCounts.set(artist, count + 1);
    }
    if (diversified.length >= limit) break;
  }

  return {
    candidates: diversified,
    seed_track: seedTrack,
    filtered_count: ownedTrackIds.size,
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
