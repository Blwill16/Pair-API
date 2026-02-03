import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(
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

    const { data: updatedPlaylist, error: updateError } = await supabase
      .from("playlists")
      .update({ is_public: true })
      .eq("id", id)
      .select()
      .single();

    if (updateError) {
      return NextResponse.json(
        { error: "Failed to publish playlist" },
        { status: 500 }
      );
    }

    return NextResponse.json({ playlist: updatedPlaylist });
  } catch (error) {
    console.error("Publish playlist error:", error);
    return NextResponse.json(
      { error: "Failed to publish playlist" },
      { status: 500 }
    );
  }
}
