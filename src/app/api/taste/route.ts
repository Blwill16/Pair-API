// Taste API
// POST /api/taste/refresh - Manually trigger taste vector refresh
// GET /api/taste - Get user's current taste profile

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  try {
    const userId = request.headers.get("x-user-id");
    
    if (!userId) {
      return NextResponse.json(
        { error: "User ID required" },
        { status: 401 }
      );
    }
    
    // Get taste vector
    const { data: tasteVector } = await supabase
      .from("user_taste_vectors")
      .select("*")
      .eq("user_id", userId)
      .single();
    
    // Get genre preferences
    const { data: genrePrefs } = await supabase
      .from("user_genre_preferences")
      .select(`
        weight,
        is_active,
        curated_genres(slug, display_name)
      `)
      .eq("user_id", userId);
    
    // Get interaction stats
    const { data: interactions } = await supabase
      .from("pairing_interactions")
      .select("interaction_type")
      .eq("user_id", userId);
    
    const stats = {
      total_interactions: interactions?.length || 0,
      likes: interactions?.filter(i => i.interaction_type === "liked").length || 0,
      dislikes: interactions?.filter(i => i.interaction_type === "disliked").length || 0,
      saves: interactions?.filter(i => i.interaction_type === "saved").length || 0,
      skips: interactions?.filter(i => i.interaction_type === "skipped").length || 0
    };
    
    return NextResponse.json({
      taste_vector: tasteVector || {
        preferred_energy: 0.5,
        preferred_valence: 0.5,
        preferred_danceability: 0.5,
        preferred_acousticness: 0.5,
        preferred_tempo: 120
      },
      genre_preferences: (genrePrefs || []).map(p => ({
        slug: (p.curated_genres as any)?.slug,
        display_name: (p.curated_genres as any)?.display_name,
        weight: p.weight,
        is_active: p.is_active
      })),
      stats
    });
    
  } catch (error) {
    console.error("[Taste API] Error:", error);
    return NextResponse.json(
      { error: "Failed to get taste profile" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = request.headers.get("x-user-id");
    
    if (!userId) {
      return NextResponse.json(
        { error: "User ID required" },
        { status: 401 }
      );
    }
    
    // Recalculate taste vector from all positive interactions
    const { data: likedTracks } = await supabase
      .from("pairing_interactions")
      .select(`
        pair_tracks(energy, valence, danceability, acousticness, tempo, genres)
      `)
      .eq("user_id", userId)
      .in("interaction_type", ["liked", "saved"]);
    
    if (!likedTracks || likedTracks.length === 0) {
      return NextResponse.json({
        message: "No interactions to learn from yet",
        taste_vector: null
      });
    }
    
    // Calculate averages
    let totalEnergy = 0, totalValence = 0, totalDanceability = 0;
    let totalAcousticness = 0, totalTempo = 0, count = 0;
    const genreCounts: Record<string, number> = {};
    
    for (const interaction of likedTracks) {
      const track = interaction.pair_tracks as any;
      if (!track) continue;
      
      totalEnergy += track.energy ?? 0.5;
      totalValence += track.valence ?? 0.5;
      totalDanceability += track.danceability ?? 0.5;
      totalAcousticness += track.acousticness ?? 0.5;
      totalTempo += track.tempo ?? 120;
      count++;
      
      // Count genres
      if (track.genres) {
        for (const genre of track.genres) {
          genreCounts[genre.toLowerCase()] = (genreCounts[genre.toLowerCase()] || 0) + 1;
        }
      }
    }
    
    if (count === 0) {
      return NextResponse.json({
        message: "No valid tracks to learn from",
        taste_vector: null
      });
    }
    
    const newVector = {
      user_id: userId,
      preferred_energy: totalEnergy / count,
      preferred_valence: totalValence / count,
      preferred_danceability: totalDanceability / count,
      preferred_acousticness: totalAcousticness / count,
      preferred_tempo: totalTempo / count,
      preferred_genres: genreCounts,
      positive_track_count: count,
      computed_at: new Date().toISOString()
    };
    
    // Upsert taste vector
    const { error } = await supabase
      .from("user_taste_vectors")
      .upsert(newVector, { onConflict: "user_id" });
    
    if (error) {
      console.error("[Taste API] Error updating vector:", error);
      return NextResponse.json(
        { error: "Failed to update taste vector" },
        { status: 500 }
      );
    }
    
    return NextResponse.json({
      message: "Taste vector refreshed",
      taste_vector: newVector,
      tracks_analyzed: count
    });
    
  } catch (error) {
    console.error("[Taste API] Error:", error);
    return NextResponse.json(
      { error: "Failed to refresh taste" },
      { status: 500 }
    );
  }
}
