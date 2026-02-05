// Curated Genres API
// GET /api/genres - Get all active curated genres
// PATCH /api/genres/weights - Update user's genre weights (More/Less)

import { NextRequest, NextResponse } from "next/server";
import { getCuratedGenres } from "@/lib/curatorEngine";
import { supabase } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  try {
    const genres = await getCuratedGenres();
    
    // Get user's preferences if authenticated
    const userId = request.headers.get("x-user-id");
    
    if (userId) {
      const { data: preferences } = await supabase
        .from("user_genre_preferences")
        .select("genre_id, weight, is_active")
        .eq("user_id", userId);
      
      const prefMap = new Map(
        (preferences || []).map(p => [p.genre_id, p])
      );
      
      const genresWithPrefs = genres.map(g => ({
        ...g,
        user_weight: prefMap.get(g.id)?.weight ?? 1.0,
        user_active: prefMap.get(g.id)?.is_active ?? true
      }));
      
      return NextResponse.json({ genres: genresWithPrefs });
    }
    
    return NextResponse.json({ genres });
    
  } catch (error) {
    console.error("[Genres API] Error:", error);
    return NextResponse.json(
      { error: "Failed to get genres" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const userId = request.headers.get("x-user-id");
    
    if (!userId) {
      return NextResponse.json(
        { error: "User ID required" },
        { status: 401 }
      );
    }
    
    const body = await request.json();
    const { genre_id, weight, is_active } = body;
    
    if (!genre_id) {
      return NextResponse.json(
        { error: "genre_id required" },
        { status: 400 }
      );
    }
    
    // Upsert preference
    const { error } = await supabase
      .from("user_genre_preferences")
      .upsert({
        user_id: userId,
        genre_id,
        weight: weight ?? 1.0,
        is_active: is_active ?? true
      }, {
        onConflict: "user_id,genre_id"
      });
    
    if (error) {
      console.error("[Genres API] Error updating preference:", error);
      return NextResponse.json(
        { error: "Failed to update preference" },
        { status: 500 }
      );
    }
    
    return NextResponse.json({ success: true });
    
  } catch (error) {
    console.error("[Genres API] Error:", error);
    return NextResponse.json(
      { error: "Failed to update genre preference" },
      { status: 500 }
    );
  }
}
