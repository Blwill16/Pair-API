import { NextRequest, NextResponse } from "next/server";
import { searchTracks } from "@/lib/spotify";
import { searchAppleMusicTracks } from "@/lib/appleMusic";

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

    // Check Apple Music credentials at runtime
    const useAppleMusic = process.env.APPLE_MUSIC_PRIVATE_KEY && process.env.APPLE_MUSIC_TEAM_ID && process.env.APPLE_MUSIC_KEY_ID;

    if (useAppleMusic) {
      // Use Apple Music API
      const appleMusicTracks = await searchAppleMusicTracks(query, 10);
      // Transform to match the existing track format expected by iOS app
      const tracks = appleMusicTracks.map(track => ({
        track_id: track.apple_music_id,
        track_name: track.track_name,
        artist_name: track.artist_name,
        artist_id: track.apple_music_id, // Use track ID as artist ID for now
        album_art_url: track.album_art_url || "",
        preview_url: track.preview_url || null,
        spotify_url: `https://music.apple.com/us/song/${track.apple_music_id}`, // Apple Music URL
      }));
      return NextResponse.json({ tracks });
    }

    // Fall back to Spotify mock data
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
