import { NextRequest, NextResponse } from "next/server";
import { searchTracks } from "@/lib/spotify";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get("q");

    if (!query) {
      return NextResponse.json(
        { error: "Missing query parameter 'q'" },
        { status: 400 }
      );
    }

    const tracks = await searchTracks(query, 10);
    return NextResponse.json({ tracks });
  } catch (error) {
    console.error("Search error:", error);
    return NextResponse.json(
      { error: "Failed to search tracks" },
      { status: 500 }
    );
  }
}
