// User Event Logging Endpoint
// Tracks: viewed, preview_play, skip, like, save/add_to_playlist, etc.

import { NextRequest, NextResponse } from "next/server";
import { logUserEvent, computeTasteVector } from "@/lib/pairBrain";

const VALID_EVENT_TYPES = [
  "viewed",
  "preview_play",
  "preview_complete",
  "skip",
  "like",
  "unlike",
  "save",
  "unsave",
  "share",
  "play_full",
];

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      user_id,
      track_apple_music_id,
      event_type,
      context,
      session_id,
      duration_ms,
    } = body;

    // Validate required fields
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

    if (!event_type || !VALID_EVENT_TYPES.includes(event_type)) {
      return NextResponse.json(
        { error: `event_type must be one of: ${VALID_EVENT_TYPES.join(", ")}` },
        { status: 400 }
      );
    }

    // Log the event
    await logUserEvent(
      user_id,
      track_apple_music_id,
      event_type,
      context,
      session_id,
      duration_ms
    );

    // For significant events, trigger taste vector recomputation
    if (["like", "save", "skip"].includes(event_type)) {
      // Run async - don't block the response
      computeTasteVector(user_id).catch((err) =>
        console.error("Taste vector computation error:", err)
      );
    }

    return NextResponse.json({
      success: true,
      event: {
        user_id,
        track_apple_music_id,
        event_type,
        context,
        logged_at: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Event logging error:", error);
    return NextResponse.json(
      { error: "Failed to log event", details: String(error) },
      { status: 500 }
    );
  }
}

// Batch event logging
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { user_id, events } = body;

    if (!user_id) {
      return NextResponse.json(
        { error: "user_id is required" },
        { status: 400 }
      );
    }

    if (!Array.isArray(events) || events.length === 0) {
      return NextResponse.json(
        { error: "events array is required" },
        { status: 400 }
      );
    }

    // Log all events
    const results = [];
    for (const event of events) {
      const { track_apple_music_id, event_type, context, session_id, duration_ms } = event;
      
      if (!track_apple_music_id || !VALID_EVENT_TYPES.includes(event_type)) {
        results.push({ success: false, error: "Invalid event data" });
        continue;
      }

      try {
        await logUserEvent(
          user_id,
          track_apple_music_id,
          event_type,
          context,
          session_id,
          duration_ms
        );
        results.push({ success: true, track_apple_music_id, event_type });
      } catch (err) {
        results.push({ success: false, error: String(err) });
      }
    }

    // Trigger taste vector recomputation
    computeTasteVector(user_id).catch((err) =>
      console.error("Taste vector computation error:", err)
    );

    return NextResponse.json({
      success: true,
      logged_count: results.filter((r) => r.success).length,
      results,
    });
  } catch (error) {
    console.error("Batch event logging error:", error);
    return NextResponse.json(
      { error: "Failed to log events", details: String(error) },
      { status: 500 }
    );
  }
}
