// Push Token Registration Endpoint
// Register/update APNs device tokens for push notifications

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// Register or update push token
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { user_id, device_token, platform = "ios" } = body;

    if (!user_id) {
      return NextResponse.json(
        { error: "user_id is required" },
        { status: 400 }
      );
    }

    if (!device_token) {
      return NextResponse.json(
        { error: "device_token is required" },
        { status: 400 }
      );
    }

    if (!["ios", "android", "web"].includes(platform)) {
      return NextResponse.json(
        { error: "platform must be one of: ios, android, web" },
        { status: 400 }
      );
    }

    // Upsert the token
    const { error } = await supabase.from("push_tokens").upsert(
      {
        user_id,
        device_token,
        platform,
        is_active: true,
        last_used_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "user_id,device_token",
      }
    );

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      message: "Push token registered",
      device_token,
      platform,
    });
  } catch (error) {
    console.error("Push token registration error:", error);
    return NextResponse.json(
      { error: "Failed to register push token", details: String(error) },
      { status: 500 }
    );
  }
}

// Deactivate push token (e.g., on logout)
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("user_id");
    const deviceToken = searchParams.get("device_token");

    if (!userId) {
      return NextResponse.json(
        { error: "user_id is required" },
        { status: 400 }
      );
    }

    let query = supabase
      .from("push_tokens")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("user_id", userId);

    if (deviceToken) {
      // Deactivate specific token
      query = query.eq("device_token", deviceToken);
    }
    // If no device_token, deactivate all tokens for user

    const { error } = await query;

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      message: deviceToken
        ? "Push token deactivated"
        : "All push tokens deactivated for user",
    });
  } catch (error) {
    console.error("Push token deactivation error:", error);
    return NextResponse.json(
      { error: "Failed to deactivate push token", details: String(error) },
      { status: 500 }
    );
  }
}

// Get user's active push tokens
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("user_id");

    if (!userId) {
      return NextResponse.json(
        { error: "user_id is required" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("push_tokens")
      .select("id, device_token, platform, is_active, last_used_at, created_at")
      .eq("user_id", userId)
      .eq("is_active", true);

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      tokens: data || [],
    });
  } catch (error) {
    console.error("Push token fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch push tokens", details: String(error) },
      { status: 500 }
    );
  }
}
