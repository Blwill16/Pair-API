// Pair Brain Recommendation Endpoint
// Input: seed_track_apple_id + prompt_text + mode
// Output: ranked list of candidates with short reasons
// Implements "no recycling" - owned tracks never appear in discovery

import { NextRequest, NextResponse } from "next/server";
import { generateRecommendations, PairingMode } from "@/lib/pairBrain";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      seed_track_apple_id,
      prompt_text,
      mode,
      user_id,
      limit = 20,
    } = body;

    // Validate required fields
    if (!seed_track_apple_id) {
      return NextResponse.json(
        { error: "seed_track_apple_id is required" },
        { status: 400 }
      );
    }

    if (!mode || !["same_sound", "same_vibe", "same_scene", "adventure"].includes(mode)) {
      return NextResponse.json(
        { error: "mode must be one of: same_sound, same_vibe, same_scene, adventure" },
        { status: 400 }
      );
    }

    // Generate recommendations with no-recycling filter
    const result = await generateRecommendations({
      seed_track_apple_id,
      prompt_text: prompt_text || "",
      mode: mode as PairingMode,
      user_id,
      limit,
    });

    return NextResponse.json({
      success: true,
      seed_track: {
        apple_music_id: result.seed_track.apple_music_id,
        track_name: result.seed_track.track_name,
        artist_name: result.seed_track.artist_name,
        album_name: result.seed_track.album_name,
        album_art_url: result.seed_track.album_art_url,
        preview_url: result.seed_track.preview_url,
      },
      recommendations: result.candidates.map((c, index) => ({
        rank: index + 1,
        apple_music_id: c.track.apple_music_id,
        track_name: c.track.track_name,
        artist_name: c.track.artist_name,
        album_name: c.track.album_name,
        album_art_url: c.track.album_art_url,
        preview_url: c.track.preview_url,
        score: Math.round(c.score * 100) / 100,
        reason: c.reason,
      })),
      meta: {
        mode,
        prompt_text,
        filtered_owned_count: result.filtered_count,
        total_returned: result.candidates.length,
      },
    });
  } catch (error) {
    console.error("Recommendation error:", error);
    return NextResponse.json(
      { error: "Failed to generate recommendations", details: String(error) },
      { status: 500 }
    );
  }
}
