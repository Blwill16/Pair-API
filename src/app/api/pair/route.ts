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

interface PairRequest {
  userId?: string;
  seedTrackId: string;
  prompt?: string;
  mode: PairingMode;
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
