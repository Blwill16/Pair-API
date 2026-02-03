// Release Radar Job Endpoint
// Daily job to ingest new catalog candidates and match against user taste vectors
// Sends push notifications via APNs for top 1-3 matches per user

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { mockAppleMusicTracks, PairTrack } from "@/lib/appleMusic";

// Simulated new releases for demo (in production, would fetch from Apple Music RSS/API)
const mockNewReleases: PairTrack[] = [
  {
    apple_music_id: "new_release_001",
    track_name: "Midnight Dreams",
    artist_name: "Aurora Waves",
    album_name: "Nocturnal",
    album_art_url: "https://is1-ssl.mzstatic.com/image/thumb/Music125/new1.jpg",
    preview_url: "https://audio-ssl.itunes.apple.com/new1.m4a",
    duration_ms: 215000,
    release_date: new Date().toISOString().split("T")[0],
    genres: ["Electronic", "Ambient"],
    energy: 0.45,
    valence: 0.35,
    danceability: 0.55,
    acousticness: 0.25,
    instrumentalness: 0.40,
    tempo: 95,
  },
  {
    apple_music_id: "new_release_002",
    track_name: "Golden Hour",
    artist_name: "Sunset Collective",
    album_name: "Daybreak",
    album_art_url: "https://is1-ssl.mzstatic.com/image/thumb/Music125/new2.jpg",
    preview_url: "https://audio-ssl.itunes.apple.com/new2.m4a",
    duration_ms: 198000,
    release_date: new Date().toISOString().split("T")[0],
    genres: ["Pop", "Indie"],
    energy: 0.72,
    valence: 0.78,
    danceability: 0.68,
    acousticness: 0.15,
    instrumentalness: 0.00,
    tempo: 118,
  },
  {
    apple_music_id: "new_release_003",
    track_name: "Echoes",
    artist_name: "The Wanderers",
    album_name: "Lost & Found",
    album_art_url: "https://is1-ssl.mzstatic.com/image/thumb/Music125/new3.jpg",
    preview_url: "https://audio-ssl.itunes.apple.com/new3.m4a",
    duration_ms: 245000,
    release_date: new Date().toISOString().split("T")[0],
    genres: ["Alternative", "Rock"],
    energy: 0.58,
    valence: 0.42,
    danceability: 0.48,
    acousticness: 0.35,
    instrumentalness: 0.10,
    tempo: 105,
  },
];

interface TasteVector {
  user_id: string;
  preferred_energy: number;
  preferred_valence: number;
  preferred_danceability: number;
  preferred_acousticness: number;
  preferred_instrumentalness: number;
  preferred_tempo: number;
}

function computeMatchScore(track: PairTrack, taste: TasteVector): number {
  const features = [
    { track: track.energy ?? 0.5, taste: taste.preferred_energy ?? 0.5, weight: 1.2 },
    { track: track.valence ?? 0.5, taste: taste.preferred_valence ?? 0.5, weight: 1.0 },
    { track: track.danceability ?? 0.5, taste: taste.preferred_danceability ?? 0.5, weight: 1.1 },
    { track: track.acousticness ?? 0.5, taste: taste.preferred_acousticness ?? 0.5, weight: 0.8 },
    { track: track.instrumentalness ?? 0.5, taste: taste.preferred_instrumentalness ?? 0.5, weight: 0.7 },
    { track: (track.tempo ?? 100) / 200, taste: (taste.preferred_tempo ?? 100) / 200, weight: 0.9 },
  ];

  let similarity = 0;
  let totalWeight = 0;

  for (const f of features) {
    const diff = Math.abs(f.track - f.taste);
    similarity += (1 - diff) * f.weight;
    totalWeight += f.weight;
  }

  return similarity / totalWeight;
}

function generateMatchReason(track: PairTrack, taste: TasteVector): string {
  const reasons: string[] = [];

  if (Math.abs((track.energy ?? 0.5) - (taste.preferred_energy ?? 0.5)) < 0.15) {
    reasons.push("matches your energy preference");
  }
  if (Math.abs((track.valence ?? 0.5) - (taste.preferred_valence ?? 0.5)) < 0.15) {
    reasons.push("fits your mood");
  }
  if (Math.abs((track.danceability ?? 0.5) - (taste.preferred_danceability ?? 0.5)) < 0.15) {
    reasons.push("has your groove");
  }

  if (reasons.length === 0) {
    return "New release you might enjoy";
  }

  return reasons.slice(0, 2).join(" and ");
}

// Ingest new releases into the catalog
async function ingestNewReleases(source: string = "apple_rss"): Promise<number> {
  let ingestedCount = 0;

  // In production, fetch from Apple Music RSS or API
  // For now, use mock data
  const newReleases = mockNewReleases;

  for (const track of newReleases) {
    try {
      // Insert into pair_tracks if not exists
      const { data: existingTrack } = await supabase
        .from("pair_tracks")
        .select("id")
        .eq("apple_music_id", track.apple_music_id)
        .single();

      let trackId: string;

      if (!existingTrack) {
        const { data: newTrack, error } = await supabase
          .from("pair_tracks")
          .insert({
            apple_music_id: track.apple_music_id,
            track_name: track.track_name,
            artist_name: track.artist_name,
            album_name: track.album_name,
            album_art_url: track.album_art_url,
            preview_url: track.preview_url,
            duration_ms: track.duration_ms,
            release_date: track.release_date,
            genres: track.genres,
            energy: track.energy,
            valence: track.valence,
            danceability: track.danceability,
            acousticness: track.acousticness,
            instrumentalness: track.instrumentalness,
            tempo: track.tempo,
            source: "apple_music",
          })
          .select("id")
          .single();

        if (error || !newTrack) continue;
        trackId = newTrack.id;
      } else {
        trackId = existingTrack.id;
      }

      // Add to release_radar_candidates
      await supabase.from("release_radar_candidates").upsert({
        track_id: trackId,
        source,
        processed: false,
      });

      ingestedCount++;
    } catch (error) {
      console.error("Error ingesting track:", track.apple_music_id, error);
    }
  }

  return ingestedCount;
}

// Process candidates and match against user taste vectors
async function processReleaseRadar(): Promise<{ matched: number; notified: number }> {
  let matchedCount = 0;
  let notifiedCount = 0;

  // Get unprocessed candidates
  const { data: candidates } = await supabase
    .from("release_radar_candidates")
    .select(`
      id,
      track_id,
      pair_tracks (
        id,
        apple_music_id,
        track_name,
        artist_name,
        energy,
        valence,
        danceability,
        acousticness,
        instrumentalness,
        tempo
      )
    `)
    .eq("processed", false)
    .limit(100);

  if (!candidates || candidates.length === 0) {
    return { matched: 0, notified: 0 };
  }

  // Get all user taste vectors
  const { data: tasteVectors } = await supabase
    .from("user_taste_vectors")
    .select("*");

  if (!tasteVectors || tasteVectors.length === 0) {
    // Mark candidates as processed even if no users to match
    for (const candidate of candidates) {
      await supabase
        .from("release_radar_candidates")
        .update({ processed: true, processed_at: new Date().toISOString() })
        .eq("id", candidate.id);
    }
    return { matched: 0, notified: 0 };
  }

  // Match each candidate against each user's taste
  for (const candidate of candidates) {
    const track = candidate.pair_tracks as PairTrack | null;
    if (!track) continue;

    for (const taste of tasteVectors) {
      // Check if user already owns this track
      const { data: owned } = await supabase
        .from("user_library")
        .select("id")
        .eq("user_id", taste.user_id)
        .eq("track_id", candidate.track_id)
        .eq("state", "owned")
        .single();

      if (owned) continue; // Skip owned tracks

      const matchScore = computeMatchScore(track, taste as TasteVector);

      // Only create match if score is above threshold
      if (matchScore >= 0.7) {
        const matchReason = generateMatchReason(track, taste as TasteVector);

        await supabase.from("release_radar_matches").upsert({
          user_id: taste.user_id,
          track_id: candidate.track_id,
          match_score: matchScore,
          match_reason: matchReason,
        });

        matchedCount++;
      }
    }

    // Mark candidate as processed
    await supabase
      .from("release_radar_candidates")
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq("id", candidate.id);
  }

  // Send push notifications for top matches
  notifiedCount = await sendPushNotifications();

  return { matched: matchedCount, notified: notifiedCount };
}

// Send push notifications via APNs
async function sendPushNotifications(): Promise<number> {
  let notifiedCount = 0;

  // Get unnotified matches grouped by user (top 3 per user)
  const { data: users } = await supabase
    .from("release_radar_matches")
    .select("user_id")
    .eq("notified", false)
    .order("match_score", { ascending: false });

  if (!users) return 0;

  const uniqueUserIds = [...new Set(users.map((u) => u.user_id))];

  for (const userId of uniqueUserIds) {
    // Get top 3 matches for this user
    const { data: matches } = await supabase
      .from("release_radar_matches")
      .select(`
        id,
        match_score,
        match_reason,
        pair_tracks (
          track_name,
          artist_name
        )
      `)
      .eq("user_id", userId)
      .eq("notified", false)
      .order("match_score", { ascending: false })
      .limit(3);

    if (!matches || matches.length === 0) continue;

    // Get user's push tokens
    const { data: tokens } = await supabase
      .from("push_tokens")
      .select("device_token, platform")
      .eq("user_id", userId)
      .eq("is_active", true);

    if (!tokens || tokens.length === 0) continue;

    // Build notification payload
    const trackNames = matches
      .map((m) => {
        const track = m.pair_tracks as { track_name: string; artist_name: string } | null;
        return track ? `${track.track_name} by ${track.artist_name}` : null;
      })
      .filter(Boolean)
      .slice(0, 3);

    const notificationBody =
      matches.length === 1
        ? `New release: ${trackNames[0]}`
        : `${matches.length} new releases for you: ${trackNames.join(", ")}`;

    // Send to each device token
    for (const token of tokens) {
      if (token.platform === "ios") {
        // In production, send via APNs
        // For now, log the notification
        console.log("APNs notification:", {
          device_token: token.device_token,
          title: "New Music For You",
          body: notificationBody,
          badge: matches.length,
        });

        // TODO: Implement actual APNs sending
        // await sendAPNsNotification(token.device_token, {
        //   title: "New Music For You",
        //   body: notificationBody,
        //   badge: matches.length,
        // });
      }
    }

    // Mark matches as notified
    for (const match of matches) {
      await supabase
        .from("release_radar_matches")
        .update({ notified: true, notified_at: new Date().toISOString() })
        .eq("id", match.id);
      notifiedCount++;
    }
  }

  return notifiedCount;
}

// Manual trigger endpoint (for cron job or manual testing)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { action = "full" } = body;

    let result: { ingested?: number; matched?: number; notified?: number } = {};

    if (action === "ingest" || action === "full") {
      result.ingested = await ingestNewReleases();
    }

    if (action === "process" || action === "full") {
      const processResult = await processReleaseRadar();
      result.matched = processResult.matched;
      result.notified = processResult.notified;
    }

    return NextResponse.json({
      success: true,
      action,
      result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Release radar error:", error);
    return NextResponse.json(
      { error: "Release radar job failed", details: String(error) },
      { status: 500 }
    );
  }
}

// Get user's release radar matches
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("user_id");
    const limit = parseInt(searchParams.get("limit") || "10");

    if (!userId) {
      return NextResponse.json(
        { error: "user_id is required" },
        { status: 400 }
      );
    }

    const { data: matches, error } = await supabase
      .from("release_radar_matches")
      .select(`
        id,
        match_score,
        match_reason,
        viewed,
        created_at,
        pair_tracks (
          id,
          apple_music_id,
          track_name,
          artist_name,
          album_name,
          album_art_url,
          preview_url,
          genres
        )
      `)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      matches: matches?.map((m) => ({
        id: m.id,
        match_score: m.match_score,
        match_reason: m.match_reason,
        viewed: m.viewed,
        created_at: m.created_at,
        track: m.pair_tracks,
      })) || [],
    });
  } catch (error) {
    console.error("Release radar fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch release radar", details: String(error) },
      { status: 500 }
    );
  }
}
