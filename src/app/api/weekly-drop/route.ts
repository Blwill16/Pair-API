// Weekly Drop API
// GET /api/weekly-drop - Get current week's drop for user
// POST /api/weekly-drop/generate - Force generate drop (admin/dev)

import { NextRequest, NextResponse } from "next/server";
import { getCurrentWeeklyDrop, generateWeeklyDrop } from "@/lib/curatorEngine";

export async function GET(request: NextRequest) {
  try {
    const userId = request.headers.get("x-user-id");
    
    if (!userId) {
      return NextResponse.json(
        { error: "User ID required" },
        { status: 401 }
      );
    }
    
    // Get preferred genres from query params (sent by iOS from user's library)
    const { searchParams } = new URL(request.url);
    const genresParam = searchParams.get("genres");
    const preferredGenres = genresParam ? genresParam.split(",").map(g => g.trim()) : undefined;
    
    if (preferredGenres && preferredGenres.length > 0) {
      console.log(`[Weekly Drop API] User's preferred genres: ${preferredGenres.join(", ")}`);
    }
    
    const { drop, tracks, genres } = await getCurrentWeeklyDrop(userId, preferredGenres);
    
    if (!drop) {
      return NextResponse.json({
        status: "empty",
        message: "No drop available this week",
        tracks: [],
        genres: {}
      });
    }
    
    // Format response for iOS app
    const formattedGenres = Object.entries(genres).map(([slug, genreTracks]) => ({
      slug,
      display_name: genreTracks[0]?.genre?.display_name || slug,
      descriptor: genreTracks[0]?.genre?.descriptor || null,
      track_count: genreTracks.length,
      tracks: genreTracks.map(t => ({
        id: t.track_id,
        apple_music_id: t.track?.apple_music_id,
        track_name: t.track?.track_name,
        artist_name: t.track?.artist_name,
        album_name: t.track?.album_name,
        album_art_url: t.track?.album_art_url,
        preview_url: t.track?.preview_url,
        confidence: t.confidence,
        reason: t.reason
      }))
    }));
    
    return NextResponse.json({
      status: drop.status,
      week_start_date: drop.week_start_date,
      total_tracks: drop.total_tracks,
      genres: formattedGenres
    });
    
  } catch (error) {
    console.error("[Weekly Drop API] Error:", error);
    return NextResponse.json(
      { error: "Failed to get weekly drop" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = request.headers.get("x-user-id");
    
    if (!userId) {
      return NextResponse.json(
        { error: "User ID required" },
        { status: 401 }
      );
    }
    
    // Force regenerate
    const drop = await generateWeeklyDrop(userId);
    
    if (!drop) {
      return NextResponse.json(
        { error: "Failed to generate drop" },
        { status: 500 }
      );
    }
    
    return NextResponse.json({
      status: drop.status,
      week_start_date: drop.week_start_date,
      total_tracks: drop.total_tracks
    });
    
  } catch (error) {
    console.error("[Weekly Drop API] Error:", error);
    return NextResponse.json(
      { error: "Failed to generate weekly drop" },
      { status: 500 }
    );
  }
}
