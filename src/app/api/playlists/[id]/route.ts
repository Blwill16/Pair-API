import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const { data: playlist, error: playlistError } = await supabase
      .from("playlists")
      .select(`
        *,
        profiles:owner_id (user_id, username, display_name, avatar_url)
      `)
      .eq("id", id)
      .single();

    if (playlistError || !playlist) {
      return NextResponse.json(
        { error: "Playlist not found" },
        { status: 404 }
      );
    }

    const { data: tracks, error: tracksError } = await supabase
      .from("playlist_tracks")
      .select("*")
      .eq("playlist_id", id)
      .order("rank", { ascending: true });

    if (tracksError) {
      console.error("Error fetching playlist tracks:", tracksError);
    }

    const { count: likeCount } = await supabase
      .from("playlist_likes")
      .select("*", { count: "exact", head: true })
      .eq("playlist_id", id);

    return NextResponse.json({
      playlist: {
        ...playlist,
        tracks: tracks || [],
        like_count: likeCount || 0,
      },
    });
  } catch (error) {
    console.error("Get playlist error:", error);
    return NextResponse.json(
      { error: "Failed to fetch playlist" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const userId = request.headers.get("x-user-id");

    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { data: playlist, error: fetchError } = await supabase
      .from("playlists")
      .select("owner_id")
      .eq("id", id)
      .single();

    if (fetchError || !playlist) {
      return NextResponse.json(
        { error: "Playlist not found" },
        { status: 404 }
      );
    }

    if (playlist.owner_id !== userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 403 }
      );
    }

    await supabase.from("playlist_tracks").delete().eq("playlist_id", id);
    await supabase.from("playlist_likes").delete().eq("playlist_id", id);

    const { error: deleteError } = await supabase
      .from("playlists")
      .delete()
      .eq("id", id);

    if (deleteError) {
      return NextResponse.json(
        { error: "Failed to delete playlist" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete playlist error:", error);
    return NextResponse.json(
      { error: "Failed to delete playlist" },
      { status: 500 }
    );
  }
}
