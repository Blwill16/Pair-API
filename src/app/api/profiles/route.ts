import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

interface CreateProfileRequest {
  userId: string;
  username: string;
  displayName?: string;
  bio?: string;
  avatarUrl?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: CreateProfileRequest = await request.json();
    const { userId, username, displayName, bio, avatarUrl } = body;

    if (!userId || !username) {
      return NextResponse.json(
        { error: "Missing userId or username" },
        { status: 400 }
      );
    }

    const { data: existing } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("username", username)
      .neq("user_id", userId)
      .single();

    if (existing) {
      return NextResponse.json(
        { error: "Username already taken" },
        { status: 409 }
      );
    }

    const { data: profile, error } = await supabase
      .from("profiles")
      .upsert({
        user_id: userId,
        username,
        display_name: displayName,
        bio,
        avatar_url: avatarUrl,
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating profile:", error);
      return NextResponse.json(
        { error: "Failed to create profile" },
        { status: 500 }
      );
    }

    return NextResponse.json({ profile });
  } catch (error) {
    console.error("Create profile error:", error);
    return NextResponse.json(
      { error: "Failed to create profile" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const userId = searchParams.get("userId");
    const username = searchParams.get("username");

    if (!userId && !username) {
      return NextResponse.json(
        { error: "Missing userId or username" },
        { status: 400 }
      );
    }

    let query = supabase.from("profiles").select("*");

    if (userId) {
      query = query.eq("user_id", userId);
    } else if (username) {
      query = query.eq("username", username);
    }

    const { data: profile, error } = await query.single();

    if (error || !profile) {
      return NextResponse.json(
        { error: "Profile not found" },
        { status: 404 }
      );
    }

    const { count: followerCount } = await supabase
      .from("follows")
      .select("*", { count: "exact", head: true })
      .eq("followee_id", profile.user_id);

    const { count: followingCount } = await supabase
      .from("follows")
      .select("*", { count: "exact", head: true })
      .eq("follower_id", profile.user_id);

    const { data: playlists } = await supabase
      .from("playlists")
      .select("*")
      .eq("owner_id", profile.user_id)
      .eq("is_public", true)
      .order("created_at", { ascending: false });

    return NextResponse.json({
      profile: {
        ...profile,
        follower_count: followerCount || 0,
        following_count: followingCount || 0,
        playlists: playlists || [],
      },
    });
  } catch (error) {
    console.error("Get profile error:", error);
    return NextResponse.json(
      { error: "Failed to fetch profile" },
      { status: 500 }
    );
  }
}
