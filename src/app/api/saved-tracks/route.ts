import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

interface SaveTrackRequest {
  userId: string;
  trackId: string;
  trackName: string;
  artistName: string;
  previewUrl?: string;
  spotifyUrl?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: SaveTrackRequest = await request.json();
    const { userId, trackId, trackName, artistName, previewUrl, spotifyUrl } = body;

    if (!userId || !trackId) {
      return NextResponse.json(
        { error: "Missing userId or trackId" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("saved_tracks")
      .upsert({
        user_id: userId,
        track_id: trackId,
        track_name: trackName,
        artist_name: artistName,
        preview_url: previewUrl,
        spotify_url: spotifyUrl,
      })
      .select()
      .single();

    if (error) {
      console.error("Error saving track:", error);
      return NextResponse.json(
        { error: "Failed to save track" },
        { status: 500 }
      );
    }

    return NextResponse.json({ saved_track: data });
  } catch (error) {
    console.error("Save track error:", error);
    return NextResponse.json(
      { error: "Failed to save track" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const userId = searchParams.get("userId");
    const trackId = searchParams.get("trackId");

    if (!userId || !trackId) {
      return NextResponse.json(
        { error: "Missing userId or trackId" },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from("saved_tracks")
      .delete()
      .eq("user_id", userId)
      .eq("track_id", trackId);

    if (error) {
      console.error("Error removing saved track:", error);
      return NextResponse.json(
        { error: "Failed to remove saved track" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Remove saved track error:", error);
    return NextResponse.json(
      { error: "Failed to remove saved track" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const userId = searchParams.get("userId");

    if (!userId) {
      return NextResponse.json(
        { error: "Missing userId" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("saved_tracks")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching saved tracks:", error);
      return NextResponse.json(
        { error: "Failed to fetch saved tracks" },
        { status: 500 }
      );
    }

    return NextResponse.json({ saved_tracks: data });
  } catch (error) {
    console.error("Get saved tracks error:", error);
    return NextResponse.json(
      { error: "Failed to fetch saved tracks" },
      { status: 500 }
    );
  }
}
