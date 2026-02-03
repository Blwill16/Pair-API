import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const userId = searchParams.get("userId");
    const limit = parseInt(searchParams.get("limit") || "20");
    const offset = parseInt(searchParams.get("offset") || "0");

    if (!userId) {
      return NextResponse.json(
        { error: "Missing userId" },
        { status: 400 }
      );
    }

    const { data: following, error: followError } = await supabase
      .from("follows")
      .select("followee_id")
      .eq("follower_id", userId);

    if (followError) {
      console.error("Error fetching following:", followError);
      return NextResponse.json(
        { error: "Failed to fetch feed" },
        { status: 500 }
      );
    }

    const followeeIds = following.map((f) => f.followee_id);

    if (followeeIds.length === 0) {
      return NextResponse.json({ playlists: [] });
    }

    const { data: playlists, error: playlistError } = await supabase
      .from("playlists")
      .select(`
        *,
        profiles:owner_id (user_id, username, display_name, avatar_url)
      `)
      .in("owner_id", followeeIds)
      .eq("is_public", true)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (playlistError) {
      console.error("Error fetching playlists:", playlistError);
      return NextResponse.json(
        { error: "Failed to fetch feed" },
        { status: 500 }
      );
    }

    const playlistIds = playlists.map((p) => p.id);

    const { data: likeCounts, error: likeError } = await supabase
      .from("playlist_likes")
      .select("playlist_id")
      .in("playlist_id", playlistIds);

    const likeCountMap: Record<string, number> = {};
    if (!likeError && likeCounts) {
      for (const like of likeCounts) {
        likeCountMap[like.playlist_id] = (likeCountMap[like.playlist_id] || 0) + 1;
      }
    }

    const { data: userLikes, error: userLikeError } = await supabase
      .from("playlist_likes")
      .select("playlist_id")
      .eq("user_id", userId)
      .in("playlist_id", playlistIds);

    const userLikedSet = new Set(userLikes?.map((l) => l.playlist_id) || []);

    const enrichedPlaylists = playlists.map((playlist) => ({
      ...playlist,
      like_count: likeCountMap[playlist.id] || 0,
      viewer_has_liked: userLikedSet.has(playlist.id),
    }));

    return NextResponse.json({ playlists: enrichedPlaylists });
  } catch (error) {
    console.error("Feed error:", error);
    return NextResponse.json(
      { error: "Failed to fetch feed" },
      { status: 500 }
    );
  }
}
