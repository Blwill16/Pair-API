import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

interface TastePreferencesRequest {
  userId: string;
  genres?: string[];
  moods?: string[];
  eras?: string[];
}

export async function POST(request: NextRequest) {
  try {
    const body: TastePreferencesRequest = await request.json();
    const { userId, genres = [], moods = [], eras = [] } = body;

    if (!userId) {
      return NextResponse.json(
        { error: "Missing userId" },
        { status: 400 }
      );
    }

    // Upsert taste preferences
    const { data, error } = await supabase
      .from("user_taste_preferences")
      .upsert({
        user_id: userId,
        genres,
        moods,
        eras,
      })
      .select()
      .single();

    if (error) {
      console.error("Error saving taste preferences:", error);
      return NextResponse.json(
        { error: "Failed to save taste preferences" },
        { status: 500 }
      );
    }

    return NextResponse.json({ preferences: data });
  } catch (error) {
    console.error("Save taste preferences error:", error);
    return NextResponse.json(
      { error: "Failed to save taste preferences" },
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
      .from("user_taste_preferences")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (error && error.code !== "PGRST116") {
      console.error("Error fetching taste preferences:", error);
      return NextResponse.json(
        { error: "Failed to fetch taste preferences" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      preferences: data || { genres: [], moods: [], eras: [] },
    });
  } catch (error) {
    console.error("Get taste preferences error:", error);
    return NextResponse.json(
      { error: "Failed to fetch taste preferences" },
      { status: 500 }
    );
  }
}
