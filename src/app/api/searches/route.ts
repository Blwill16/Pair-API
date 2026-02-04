import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

// GET /api/searches - Get trending searches and user's recent pairings
export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabase();
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("user_id");
    const type = searchParams.get("type") || "trending";

    if (type === "trending") {
      // Get most popular searches in the last 7 days
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const { data: trendingSearches, error } = await supabase
        .from("search_logs")
        .select("search_query, count")
        .gte("created_at", sevenDaysAgo.toISOString())
        .order("count", { ascending: false })
        .limit(10);

      if (error) {
        console.error("Error fetching trending searches:", error);
        // Return empty array if table doesn't exist yet
        return NextResponse.json({ searches: [] });
      }

      return NextResponse.json({ searches: trendingSearches || [] });
    }

    if (type === "recent" && userId) {
      // Get user's recent pairings
      const { data: recentPairings, error } = await supabase
        .from("playlists")
        .select(
          "id, title, seed_track_name, seed_artist_name, mode, created_at, tracks:playlist_tracks(count)"
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(5);

      if (error) {
        console.error("Error fetching recent pairings:", error);
        return NextResponse.json({ pairings: [] });
      }

      const formattedPairings = (recentPairings || []).map((p) => ({
        id: p.id,
        seedName: p.seed_track_name,
        seedArtist: p.seed_artist_name,
        mode: p.mode,
        date: p.created_at,
        trackCount: Array.isArray(p.tracks) ? p.tracks.length : 0,
      }));

      return NextResponse.json({ pairings: formattedPairings });
    }

    return NextResponse.json({ searches: [], pairings: [] });
  } catch (error) {
    console.error("Error in searches API:", error);
    return NextResponse.json(
      { error: "Failed to fetch searches" },
      { status: 500 }
    );
  }
}

// POST /api/searches - Log a search query
export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabase();
    const body = await request.json();
    const { search_query, user_id } = body;

    if (!search_query) {
      return NextResponse.json(
        { error: "search_query is required" },
        { status: 400 }
      );
    }

    // Normalize the search query
    const normalizedQuery = search_query.toLowerCase().trim();

    // Check if this search already exists
    const { data: existing } = await supabase
      .from("search_logs")
      .select("id, count")
      .eq("search_query", normalizedQuery)
      .single();

    if (existing) {
      // Increment count
      await supabase
        .from("search_logs")
        .update({ count: existing.count + 1, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
    } else {
      // Insert new search
      await supabase.from("search_logs").insert({
        search_query: normalizedQuery,
        user_id: user_id || null,
        count: 1,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error logging search:", error);
    // Don't fail the request if logging fails
    return NextResponse.json({ success: true });
  }
}
