import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

interface LikeRequest {
  userId: string;
  playlistId: string;
  action: "like" | "unlike";
}

export async function POST(request: NextRequest) {
  try {
    const body: LikeRequest = await request.json();
    const { userId, playlistId, action } = body;

    if (!userId || !playlistId) {
      return NextResponse.json(
        { error: "Missing userId or playlistId" },
        { status: 400 }
      );
    }

    if (action === "like") {
      const { error } = await supabase
        .from("playlist_likes")
        .upsert({
          user_id: userId,
          playlist_id: playlistId,
        });

      if (error) {
        console.error("Error liking playlist:", error);
        return NextResponse.json(
          { error: "Failed to like playlist" },
          { status: 500 }
        );
      }

      return NextResponse.json({ success: true, liked: true });
    } else if (action === "unlike") {
      const { error } = await supabase
        .from("playlist_likes")
        .delete()
        .eq("user_id", userId)
        .eq("playlist_id", playlistId);

      if (error) {
        console.error("Error unliking playlist:", error);
        return NextResponse.json(
          { error: "Failed to unlike playlist" },
          { status: 500 }
        );
      }

      return NextResponse.json({ success: true, liked: false });
    }

    return NextResponse.json(
      { error: "Invalid action" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Like error:", error);
    return NextResponse.json(
      { error: "Failed to process like request" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const userId = searchParams.get("userId");
    const playlistId = searchParams.get("playlistId");

    if (!userId) {
      return NextResponse.json(
        { error: "Missing userId" },
        { status: 400 }
      );
    }

    if (playlistId) {
      const { data, error } = await supabase
        .from("playlist_likes")
        .select("*")
        .eq("user_id", userId)
        .eq("playlist_id", playlistId)
        .single();

      if (error && error.code !== "PGRST116") {
        return NextResponse.json(
          { error: "Failed to check like status" },
          { status: 500 }
        );
      }

      return NextResponse.json({ liked: !!data });
    }

    const { data, error } = await supabase
      .from("playlist_likes")
      .select(`
        playlist_id,
        playlists:playlist_id (*)
      `)
      .eq("user_id", userId);

    if (error) {
      return NextResponse.json(
        { error: "Failed to fetch liked playlists" },
        { status: 500 }
      );
    }

    return NextResponse.json({ liked_playlists: data });
  } catch (error) {
    console.error("Get likes error:", error);
    return NextResponse.json(
      { error: "Failed to fetch like data" },
      { status: 500 }
    );
  }
}
