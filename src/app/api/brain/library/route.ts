// User Library Management Endpoint
// Add/remove tracks from user's library (owned state = excluded from discovery)

import { NextRequest, NextResponse } from "next/server";
import { addToUserLibrary } from "@/lib/pairBrain";
import { supabase } from "@/lib/supabase";

// Add track to library
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { user_id, track_apple_music_id, source = "discovery" } = body;

    if (!user_id) {
      return NextResponse.json(
        { error: "user_id is required" },
        { status: 400 }
      );
    }

    if (!track_apple_music_id) {
      return NextResponse.json(
        { error: "track_apple_music_id is required" },
        { status: 400 }
      );
    }

    await addToUserLibrary(user_id, track_apple_music_id, source);

    return NextResponse.json({
      success: true,
      message: "Track added to library",
      track_apple_music_id,
      state: "owned",
    });
  } catch (error) {
    console.error("Library add error:", error);
    return NextResponse.json(
      { error: "Failed to add track to library", details: String(error) },
      { status: 500 }
    );
  }
}

// Get user's library
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("user_id");
    const state = searchParams.get("state"); // owned, liked, archived
    const limit = parseInt(searchParams.get("limit") || "50");
    const offset = parseInt(searchParams.get("offset") || "0");

    if (!userId) {
      return NextResponse.json(
        { error: "user_id is required" },
        { status: 400 }
      );
    }

    let query = supabase
      .from("user_library")
      .select(`
        id,
        state,
        source,
        added_at,
        pair_tracks (
          id,
          apple_music_id,
          track_name,
          artist_name,
          album_name,
          album_art_url,
          preview_url,
          genres
        )
      `)
      .eq("user_id", userId)
      .order("added_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (state) {
      query = query.eq("state", state);
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      library: data?.map((item) => ({
        id: item.id,
        state: item.state,
        source: item.source,
        added_at: item.added_at,
        track: item.pair_tracks,
      })) || [],
      pagination: {
        limit,
        offset,
        has_more: data?.length === limit,
      },
    });
  } catch (error) {
    console.error("Library fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch library", details: String(error) },
      { status: 500 }
    );
  }
}

// Update track state in library
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { user_id, track_apple_music_id, state } = body;

    if (!user_id || !track_apple_music_id) {
      return NextResponse.json(
        { error: "user_id and track_apple_music_id are required" },
        { status: 400 }
      );
    }

    if (!["owned", "liked", "archived"].includes(state)) {
      return NextResponse.json(
        { error: "state must be one of: owned, liked, archived" },
        { status: 400 }
      );
    }

    // Find the track
    const { data: pairTrack } = await supabase
      .from("pair_tracks")
      .select("id")
      .eq("apple_music_id", track_apple_music_id)
      .single();

    if (!pairTrack) {
      return NextResponse.json(
        { error: "Track not found" },
        { status: 404 }
      );
    }

    // Update the library entry
    const { error } = await supabase
      .from("user_library")
      .update({ state })
      .eq("user_id", user_id)
      .eq("track_id", pairTrack.id);

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      message: `Track state updated to ${state}`,
      track_apple_music_id,
      state,
    });
  } catch (error) {
    console.error("Library update error:", error);
    return NextResponse.json(
      { error: "Failed to update library", details: String(error) },
      { status: 500 }
    );
  }
}

// Remove track from library
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("user_id");
    const trackAppleMusicId = searchParams.get("track_apple_music_id");

    if (!userId || !trackAppleMusicId) {
      return NextResponse.json(
        { error: "user_id and track_apple_music_id are required" },
        { status: 400 }
      );
    }

    // Find the track
    const { data: pairTrack } = await supabase
      .from("pair_tracks")
      .select("id")
      .eq("apple_music_id", trackAppleMusicId)
      .single();

    if (!pairTrack) {
      return NextResponse.json(
        { error: "Track not found" },
        { status: 404 }
      );
    }

    // Delete from library
    const { error } = await supabase
      .from("user_library")
      .delete()
      .eq("user_id", userId)
      .eq("track_id", pairTrack.id);

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      message: "Track removed from library",
      track_apple_music_id: trackAppleMusicId,
    });
  } catch (error) {
    console.error("Library delete error:", error);
    return NextResponse.json(
      { error: "Failed to remove from library", details: String(error) },
      { status: 500 }
    );
  }
}
