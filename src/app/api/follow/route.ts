import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

interface FollowRequest {
  followerId: string;
  followeeId: string;
  action: "follow" | "unfollow";
}

export async function POST(request: NextRequest) {
  try {
    const body: FollowRequest = await request.json();
    const { followerId, followeeId, action } = body;

    if (!followerId || !followeeId) {
      return NextResponse.json(
        { error: "Missing followerId or followeeId" },
        { status: 400 }
      );
    }

    if (followerId === followeeId) {
      return NextResponse.json(
        { error: "Cannot follow yourself" },
        { status: 400 }
      );
    }

    if (action === "follow") {
      const { error } = await supabase
        .from("follows")
        .upsert({
          follower_id: followerId,
          followee_id: followeeId,
        });

      if (error) {
        console.error("Error following user:", error);
        return NextResponse.json(
          { error: "Failed to follow user" },
          { status: 500 }
        );
      }

      return NextResponse.json({ success: true, following: true });
    } else if (action === "unfollow") {
      const { error } = await supabase
        .from("follows")
        .delete()
        .eq("follower_id", followerId)
        .eq("followee_id", followeeId);

      if (error) {
        console.error("Error unfollowing user:", error);
        return NextResponse.json(
          { error: "Failed to unfollow user" },
          { status: 500 }
        );
      }

      return NextResponse.json({ success: true, following: false });
    }

    return NextResponse.json(
      { error: "Invalid action" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Follow error:", error);
    return NextResponse.json(
      { error: "Failed to process follow request" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const userId = searchParams.get("userId");
    const type = searchParams.get("type") || "following";

    if (!userId) {
      return NextResponse.json(
        { error: "Missing userId" },
        { status: 400 }
      );
    }

    if (type === "following") {
      const { data, error } = await supabase
        .from("follows")
        .select(`
          followee_id,
          profiles:followee_id (user_id, username, display_name, avatar_url)
        `)
        .eq("follower_id", userId);

      if (error) {
        return NextResponse.json(
          { error: "Failed to fetch following" },
          { status: 500 }
        );
      }

      return NextResponse.json({ following: data });
    } else if (type === "followers") {
      const { data, error } = await supabase
        .from("follows")
        .select(`
          follower_id,
          profiles:follower_id (user_id, username, display_name, avatar_url)
        `)
        .eq("followee_id", userId);

      if (error) {
        return NextResponse.json(
          { error: "Failed to fetch followers" },
          { status: 500 }
        );
      }

      return NextResponse.json({ followers: data });
    }

    return NextResponse.json(
      { error: "Invalid type" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Get follow error:", error);
    return NextResponse.json(
      { error: "Failed to fetch follow data" },
      { status: 500 }
    );
  }
}
