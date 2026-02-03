import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

interface CreatePlaylistRequest {
  userId: string;
  title?: string;
  promptText?: string;
  seedTrackId?: string;
  seedTrackName?: string;
  seedArtistName?: string;
  mode?: string;
  results: {
    track_id: string;
    track_name: string;
    artist_name: string;
    preview_url?: string;
    spotify_url?: string;
    score?: number;
    explanation?: string;
  }[];
}

export async function POST(request: NextRequest) {
  try {
    const body: CreatePlaylistRequest = await request.json();
    const {
      userId,
      title,
      promptText,
      seedTrackId,
      seedTrackName,
      seedArtistName,
      mode,
      results,
    } = body;

    if (!userId) {
      return NextResponse.json(
        { error: "Missing userId" },
        { status: 400 }
      );
    }

    if (!results || results.length === 0) {
      return NextResponse.json(
        { error: "Missing results" },
        { status: 400 }
      );
    }

    const playlistTitle = title || `${seedTrackName || "Untitled"} Mix`;

    const { data: playlist, error: playlistError } = await supabase
      .from("playlists")
      .insert({
        owner_id: userId,
        title: playlistTitle,
        prompt_text: promptText,
        seed_track_id: seedTrackId,
        seed_track_name: seedTrackName,
        seed_artist_name: seedArtistName,
        mode: mode,
        is_public: false,
      })
      .select()
      .single();

    if (playlistError) {
      console.error("Error creating playlist:", playlistError);
      return NextResponse.json(
        { error: "Failed to create playlist" },
        { status: 500 }
      );
    }

    const tracksToInsert = results.map((track, index) => ({
      playlist_id: playlist.id,
      track_id: track.track_id,
      track_name: track.track_name,
      artist_name: track.artist_name,
      preview_url: track.preview_url,
      spotify_url: track.spotify_url,
      score: track.score,
      explanation: track.explanation,
      rank: index + 1,
    }));

    const { error: tracksError } = await supabase
      .from("playlist_tracks")
      .insert(tracksToInsert);

    if (tracksError) {
      console.error("Error adding tracks to playlist:", tracksError);
      return NextResponse.json(
        { error: "Failed to add tracks to playlist" },
        { status: 500 }
      );
    }

    return NextResponse.json({ playlist });
  } catch (error) {
    console.error("Create playlist error:", error);
    return NextResponse.json(
      { error: "Failed to create playlist" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get("type") || "public";
    const userId = searchParams.get("userId");
    const limit = parseInt(searchParams.get("limit") || "20");
    const offset = parseInt(searchParams.get("offset") || "0");

    let query = supabase
      .from("playlists")
      .select(`
        *,
        profiles:owner_id (username, display_name, avatar_url),
        playlist_likes (count)
      `)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (type === "public") {
      query = query.eq("is_public", true);
    } else if (type === "user" && userId) {
      query = query.eq("owner_id", userId);
    } else if (type === "trending") {
      query = query.eq("is_public", true);
    }

    const { data: playlists, error } = await query;

    if (error) {
      console.error("Error fetching playlists:", error);
      return NextResponse.json(
        { error: "Failed to fetch playlists" },
        { status: 500 }
      );
    }

    return NextResponse.json({ playlists });
  } catch (error) {
    console.error("Get playlists error:", error);
    return NextResponse.json(
      { error: "Failed to fetch playlists" },
      { status: 500 }
    );
  }
}
