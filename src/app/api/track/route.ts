// Track Actions API
// POST /api/track/play - Log preview started
// POST /api/track/complete - Log preview completed
// POST /api/track/save - Save to Apple Music playlist + log
// POST /api/track/skip - Log skip
// POST /api/track/dislike - Log dislike + add to exclusion

import { NextRequest, NextResponse } from "next/server";
import { logInteraction } from "@/lib/curatorEngine";
import { supabase } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  try {
    const userId = request.headers.get("x-user-id");
    
    if (!userId) {
      return NextResponse.json(
        { error: "User ID required" },
        { status: 401 }
      );
    }
    
    const body = await request.json();
    const { action, track_id, apple_music_id, weekly_drop_id, duration_ms, context } = body;
    
    if (!action) {
      return NextResponse.json(
        { error: "action required" },
        { status: 400 }
      );
    }
    
    // Map action to interaction type
    const actionMap: Record<string, string> = {
      play: "preview_started",
      complete: "preview_completed",
      save: "saved",
      skip: "skipped",
      dislike: "disliked",
      like: "liked",
      share: "shared"
    };
    
    const interactionType = actionMap[action];
    if (!interactionType) {
      return NextResponse.json(
        { error: "Invalid action" },
        { status: 400 }
      );
    }
    
    // Get track_id if only apple_music_id provided
    let resolvedTrackId = track_id;
    if (!resolvedTrackId && apple_music_id) {
      const { data: track } = await supabase
        .from("pair_tracks")
        .select("id")
        .eq("apple_music_id", apple_music_id)
        .single();
      
      if (track) {
        resolvedTrackId = track.id;
      }
    }
    
    if (!resolvedTrackId) {
      return NextResponse.json(
        { error: "track_id or apple_music_id required" },
        { status: 400 }
      );
    }
    
    // Log the interaction
    await logInteraction(
      userId,
      resolvedTrackId,
      interactionType,
      weekly_drop_id,
      duration_ms,
      context
    );
    
    // Handle save action - add to user's owned tracks
    if (action === "save") {
      const { data: track } = await supabase
        .from("pair_tracks")
        .select("apple_music_id")
        .eq("id", resolvedTrackId)
        .single();
      
      if (track) {
        await supabase
          .from("user_owned_tracks")
          .upsert({
            user_id: userId,
            track_id: resolvedTrackId,
            apple_music_id: track.apple_music_id,
            source: "pair_saved"
          }, {
            onConflict: "user_id,apple_music_id"
          });
      }
    }
    
    return NextResponse.json({ success: true });
    
  } catch (error) {
    console.error("[Track API] Error:", error);
    return NextResponse.json(
      { error: "Failed to process track action" },
      { status: 500 }
    );
  }
}
