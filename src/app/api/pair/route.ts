import { NextRequest, NextResponse } from "next/server";
import {
  getTrack,
  getAudioFeatures,
  getRecommendations,
  getRelatedArtists,
  getArtistTopTracks,
  getArtistGenres,
  SpotifyTrack,
  AudioFeatures,
} from "@/lib/spotify";
import {
  PairingMode,
  normalizeFeatures,
  scoreCandidate,
  rankCandidates,
  ScoredCandidate,
} from "@/lib/pairing";
import { supabase } from "@/lib/supabase";
import { getAppleMusicTrack, searchAppleMusicTracks, getMockCandidates, getAppleMusicRelatedTracks, PairTrack } from "@/lib/appleMusic";
import { generatePairing, savePairingToHistory, PairingMode as PairBrainMode } from "@/lib/pairBrainV2";

// Simple text similarity without OpenAI (per spec: "Do NOT use ChatGPT for selecting songs")
function computeTextSimilarity(
  seedTrack: PairTrack,
  candidate: PairTrack,
  promptText?: string
): number {
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

// Helper function to check Apple Music credentials at runtime
function useAppleMusic(): boolean {
  return !!(process.env.APPLE_MUSIC_PRIVATE_KEY && process.env.APPLE_MUSIC_TEAM_ID && process.env.APPLE_MUSIC_KEY_ID);
}

interface PairRequest {
  userId?: string;
  seedTrackId: string;
  prompt?: string;
  mode: PairingMode;
}

// Apple Music pairing logic
async function generateAppleMusicPairing(
  seedTrackId: string,
  prompt: string,
  mode: PairingMode,
  userId?: string
) {
  // Get seed track from Apple Music
  const seedTrack = await getAppleMusicTrack(seedTrackId);
  if (!seedTrack) {
    throw new Error("Seed track not found");
  }

  // Get owned track IDs to exclude
  const ownedTrackIds: Set<string> = new Set();
  if (userId) {
    try {
      const { data: savedTracks } = await supabase
        .from("saved_tracks")
        .select("track_id")
        .eq("user_id", userId);
      
      if (savedTracks) {
        for (const track of savedTracks) {
          ownedTrackIds.add(track.track_id);
        }
      }
    } catch (error) {
      console.error("Error fetching owned tracks:", error);
    }
  }

  // Get candidate tracks (excluding seed and owned)
  const excludeIds = [seedTrackId, ...Array.from(ownedTrackIds)];
  const candidates = await getAppleMusicRelatedTracks(seedTrack, excludeIds, 30);

  // Score candidates based on mode
  const MODE_WEIGHTS: Record<PairingMode, { sound: number; vibe: number; novelty: number }> = {
    same_sound: { sound: 0.70, vibe: 0.15, novelty: 0.15 },
    same_vibe: { sound: 0.45, vibe: 0.40, novelty: 0.15 },
    same_scene: { sound: 0.35, vibe: 0.25, novelty: 0.40 },
    adventure: { sound: 0.35, vibe: 0.35, novelty: 0.30 },
  };

  const weights = MODE_WEIGHTS[mode];
  const scoredCandidates: Array<{ track: PairTrack; score: number; explanation: string }> = [];

  for (const candidate of candidates) {
    // Compute sound similarity based on audio features
    const soundSimilarity = computeAppleMusicSoundSimilarity(seedTrack, candidate);
    
    // Compute vibe similarity using simple text overlap (no OpenAI - per spec)
    const vibeSimilarity = computeTextSimilarity(seedTrack, candidate, prompt);

    // Compute novelty score
    const noveltyScore = mode === "adventure" 
      ? (soundSimilarity >= 0.55 && soundSimilarity <= 0.80 ? 1.0 : 0.5)
      : Math.max(0, Math.min(1, 1 - soundSimilarity));

    const finalScore = weights.sound * soundSimilarity + weights.vibe * vibeSimilarity + weights.novelty * noveltyScore;
    const explanation = generateAppleMusicExplanation(seedTrack, candidate, vibeSimilarity);

    scoredCandidates.push({ track: candidate, score: finalScore, explanation });
  }

  // Sort by score and take top 20
  scoredCandidates.sort((a, b) => b.score - a.score);
  
  // Apply diversity rule: max 2 tracks per artist
  const artistCounts = new Map<string, number>();
  const diversified: typeof scoredCandidates = [];
  for (const candidate of scoredCandidates) {
    const artist = candidate.track.artist_name;
    const count = artistCounts.get(artist) || 0;
    if (count < 2) {
      diversified.push(candidate);
      artistCounts.set(artist, count + 1);
    }
    if (diversified.length >= 20) break;
  }

  return {
    seed: {
      track_id: seedTrack.apple_music_id,
      track_name: seedTrack.track_name,
      artist_name: seedTrack.artist_name,
      album_art_url: seedTrack.album_art_url,
      preview_url: seedTrack.preview_url,
      spotify_url: `https://music.apple.com/us/song/${seedTrack.apple_music_id}`,
    },
    results: diversified.map(r => ({
      track_id: r.track.apple_music_id,
      track_name: r.track.track_name,
      artist_name: r.track.artist_name,
      album_art_url: r.track.album_art_url,
      preview_url: r.track.preview_url,
      spotify_url: `https://music.apple.com/us/song/${r.track.apple_music_id}`,
      score: r.score,
      explanation: r.explanation,
    })),
  };
}

function computeAppleMusicSoundSimilarity(seed: PairTrack, candidate: PairTrack): number {
  const features = ['energy', 'valence', 'danceability', 'acousticness', 'tempo'] as const;
  let dotProduct = 0;
  let normSeed = 0;
  let normCandidate = 0;

  for (const feature of features) {
    const seedVal = seed[feature] ?? 0.5;
    const candidateVal = candidate[feature] ?? 0.5;
    // Normalize tempo to 0-1 range
    const normalizedSeed = feature === 'tempo' ? Math.max(0, Math.min(1, (seedVal - 60) / 120)) : seedVal;
    const normalizedCandidate = feature === 'tempo' ? Math.max(0, Math.min(1, (candidateVal - 60) / 120)) : candidateVal;
    
    dotProduct += normalizedSeed * normalizedCandidate;
    normSeed += normalizedSeed * normalizedSeed;
    normCandidate += normalizedCandidate * normalizedCandidate;
  }

  if (normSeed === 0 || normCandidate === 0) return 0;
  return dotProduct / (Math.sqrt(normSeed) * Math.sqrt(normCandidate));
}

function generateAppleMusicExplanation(seed: PairTrack, candidate: PairTrack, vibeSimilarity: number): string {
  const descriptors: Record<string, string[]> = {
    energy: ["driving intensity", "raw power", "electric feel"],
    valence: ["emotional tone", "uplifting spirit", "introspective feel"],
    danceability: ["infectious rhythm", "body-moving beat", "danceable pulse"],
    acousticness: ["organic texture", "warm tones", "intimate sound"],
    tempo: ["smooth pace", "steady flow", "matching rhythm"],
  };

  const emotionalPhrases = ["perfect for the moment", "hits the same way", "carries that feeling"];

  // Find most similar feature
  const features = ['energy', 'valence', 'danceability', 'acousticness', 'tempo'] as const;
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

export async function POST(request: NextRequest) {
  try {
    const body: PairRequest = await request.json();
    const { userId, seedTrackId, prompt = "", mode } = body;

    if (!seedTrackId) {
      return NextResponse.json(
        { error: "Missing seedTrackId" },
        { status: 400 }
      );
    }

    if (!["same_sound", "same_vibe", "same_scene", "adventure"].includes(mode)) {
      return NextResponse.json(
        { error: "Invalid mode" },
        { status: 400 }
      );
    }

    // Use the new 6-track slotting algorithm (Pair Brain v2)
    if (useAppleMusic()) {
      try {
        const pairingResult = await generatePairing({
          seed_track_apple_id: seedTrackId,
          prompt_text: prompt,
          mode: mode as PairBrainMode,
          user_id: userId,
          session_id: `session_${Date.now()}`
        });

        // Save to history if user is logged in
        if (userId) {
          await savePairingToHistory(pairingResult, userId);
        }

        // Format response to match existing API contract
        return NextResponse.json({
          seed: {
            track_id: pairingResult.seed_track.apple_music_id,
            track_name: pairingResult.seed_track.track_name,
            artist_name: pairingResult.seed_track.artist_name,
            album_art_url: pairingResult.seed_track.album_art_url,
            preview_url: pairingResult.seed_track.preview_url,
            spotify_url: `https://music.apple.com/us/song/${pairingResult.seed_track.apple_music_id}`,
          },
          results: pairingResult.tracks.map(t => ({
            track_id: t.track.apple_music_id,
            track_name: t.track.track_name,
            artist_name: t.track.artist_name,
            album_art_url: t.track.album_art_url,
            preview_url: t.track.preview_url,
            spotify_url: `https://music.apple.com/us/song/${t.track.apple_music_id}`,
            score: t.similarity_score,
            explanation: t.explanation,
            slot_type: t.slot_type,
            slot_position: t.slot_position,
          })),
          mode: pairingResult.mode,
          session_id: pairingResult.session_id,
          excluded_count: pairingResult.excluded_count
        });
      } catch (pairBrainError) {
        const errorMessage = pairBrainError instanceof Error ? pairBrainError.message : String(pairBrainError);
        const errorStack = pairBrainError instanceof Error ? pairBrainError.stack : "";
        console.error("Pair Brain v2 error:", errorMessage);
        console.error("Error stack:", errorStack);
        
        // Return error details in response for debugging (remove in production)
        // Fall back to legacy Apple Music pairing
        console.log("Falling back to legacy Apple Music pairing...");
        const result = await generateAppleMusicPairing(seedTrackId, prompt, mode, userId);
        console.log(`Legacy pairing returned ${result.results?.length || 0} results`);
        
        // Add debug info to response
        return NextResponse.json({
          ...result,
          _debug: {
            pairBrainV2Error: errorMessage,
            fallbackUsed: true
          }
        });
      }
    }

    // Fall back to Spotify mock data
    const seedTrack = await getTrack(seedTrackId);
    const [seedFeaturesArray] = await Promise.all([
      getAudioFeatures([seedTrackId]),
    ]);

    if (seedFeaturesArray.length === 0) {
      return NextResponse.json(
        { error: "Could not get audio features for seed track" },
        { status: 400 }
      );
    }

    const seedFeatures = normalizeFeatures(seedFeaturesArray[0]);

    const candidates: Map<string, SpotifyTrack> = new Map();

    // Taste-preserving filter: get user's owned tracks to exclude from discovery
    const ownedTrackIds: Set<string> = new Set();
    if (userId) {
      try {
        // Get saved tracks
        const { data: savedTracks } = await supabase
          .from("saved_tracks")
          .select("track_id")
          .eq("user_id", userId);
        
        if (savedTracks) {
          for (const track of savedTracks) {
            ownedTrackIds.add(track.track_id);
          }
        }

        // Get tracks from user's playlists
        const { data: userPlaylists } = await supabase
          .from("playlists")
          .select("id")
          .eq("owner_id", userId);
        
        if (userPlaylists && userPlaylists.length > 0) {
          const playlistIds = userPlaylists.map(p => p.id);
          const { data: playlistTracks } = await supabase
            .from("playlist_tracks")
            .select("track_id")
            .in("playlist_id", playlistIds);
          
          if (playlistTracks) {
            for (const track of playlistTracks) {
              ownedTrackIds.add(track.track_id);
            }
          }
        }
      } catch (error) {
        console.error("Error fetching owned tracks:", error);
      }
    }

    const recommendations = await getRecommendations(seedTrackId, 100);
    for (const track of recommendations) {
      // Exclude seed track and any tracks the user already owns
      if (track.track_id !== seedTrackId && !ownedTrackIds.has(track.track_id)) {
        candidates.set(track.track_id, track);
      }
    }

    const relatedArtistIds: Set<string> = new Set();
    try {
      const relatedArtists = await getRelatedArtists(seedTrack.artist_id);
      for (const artistId of relatedArtists) {
        relatedArtistIds.add(artistId);
        const topTracks = await getArtistTopTracks(artistId);
        for (const track of topTracks) {
          // Exclude seed track, already added tracks, and owned tracks
          if (track.track_id !== seedTrackId && !candidates.has(track.track_id) && !ownedTrackIds.has(track.track_id)) {
            candidates.set(track.track_id, track);
          }
        }
      }
    } catch (error) {
      console.error("Error getting related artists:", error);
    }

    const genres = await getArtistGenres(seedTrack.artist_id);

    const candidateIds = Array.from(candidates.keys());
    const allFeatures: Map<string, AudioFeatures> = new Map();

    for (let i = 0; i < candidateIds.length; i += 100) {
      const batch = candidateIds.slice(i, i + 100);
      const features = await getAudioFeatures(batch);
      for (const f of features) {
        allFeatures.set(f.track_id, f);
      }
    }

    const scoredCandidates: ScoredCandidate[] = [];

    for (const [trackId, track] of candidates) {
      const features = allFeatures.get(trackId);
      if (!features) continue;

      const scored = await scoreCandidate(
        seedTrack,
        seedFeatures,
        track,
        features,
        prompt,
        mode,
        relatedArtistIds,
        genres
      );

      scoredCandidates.push(scored);
    }

    const topResults = rankCandidates(scoredCandidates, 20);

    if (userId) {
      try {
        const { data: promptData, error: promptError } = await supabase
          .from("prompts")
          .insert({
            user_id: userId,
            seed_track_id: seedTrackId,
            seed_track_name: seedTrack.track_name,
            seed_artist_name: seedTrack.artist_name,
            prompt_text: prompt,
            mode: mode,
          })
          .select()
          .single();

        if (promptError) {
          console.error("Error saving prompt:", promptError);
        } else if (promptData) {
          const recommendationsToInsert = topResults.map((r, index) => ({
            prompt_id: promptData.id,
            track_id: r.track.track_id,
            track_name: r.track.track_name,
            artist_name: r.track.artist_name,
            preview_url: r.track.preview_url,
            spotify_url: r.track.spotify_url,
            score: r.finalScore,
            explanation: r.explanation,
            rank: index + 1,
          }));

          const { error: recError } = await supabase
            .from("recommendations")
            .insert(recommendationsToInsert);

          if (recError) {
            console.error("Error saving recommendations:", recError);
          }
        }
      } catch (error) {
        console.error("Error persisting to Supabase:", error);
      }
    }

    const results = topResults.map((r) => ({
      track_id: r.track.track_id,
      track_name: r.track.track_name,
      artist_name: r.track.artist_name,
      album_art_url: r.track.album_art_url,
      preview_url: r.track.preview_url,
      spotify_url: r.track.spotify_url,
      score: r.finalScore,
      explanation: r.explanation,
    }));

    return NextResponse.json({
      seed: {
        track_id: seedTrack.track_id,
        track_name: seedTrack.track_name,
        artist_name: seedTrack.artist_name,
        album_art_url: seedTrack.album_art_url,
        preview_url: seedTrack.preview_url,
        spotify_url: seedTrack.spotify_url,
      },
      results,
    });
  } catch (error) {
    console.error("Pair error:", error);
    return NextResponse.json(
      { error: "Failed to generate recommendations" },
      { status: 500 }
    );
  }
}
