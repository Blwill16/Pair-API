import { supabase } from "./supabase";
import { PairTrack, getAppleMusicNewReleases } from "./appleMusic";

export interface CuratedGenre {
  id: string;
  slug: string;
  display_name: string;
  descriptor: string | null;
  search_keywords: string[];
  is_active: boolean;
}

export interface WeeklyDrop {
  id: string;
  user_id: string;
  week_start_date: string;
  status: "pending" | "generating" | "generated" | "empty" | "failed";
  total_tracks: number;
  notified: boolean;
}

export interface WeeklyDropTrack {
  id: string;
  weekly_drop_id: string;
  genre_id: string;
  track_id: string;
  position: number;
  confidence: number;
  audio_sim: number;
  text_sim: number;
  scene_sim: number;
  reason: string;
  track?: PairTrack;
  genre?: CuratedGenre;
}

const MIN_TRACKS_PER_GENRE = 5;
const MAX_TRACKS_PER_GENRE = 5;
const MAX_TRACKS_PER_ARTIST_PER_GENRE = 1;
const MAX_TRACKS_PER_ARTIST_GLOBAL = 1;

const BROAD_GENRES: Array<{
  slug: string;
  display_name: string;
  descriptor: string;
  keywords: string[];
}> = [
  {
    slug: "electronic",
    display_name: "Electronic",
    descriptor: "Synth-forward, rhythmic, club-leaning",
    keywords: ["electronic", "edm", "house", "techno", "trance", "dance", "dnb", "drum and bass", "electro"],
  },
  {
    slug: "indie-alternative",
    display_name: "Indie / Alternative",
    descriptor: "Independent, textural, left-of-center",
    keywords: ["indie", "alternative", "alt", "shoegaze", "post-punk", "dream pop"],
  },
  {
    slug: "rnb-soul",
    display_name: "R&B / Soul",
    descriptor: "Smooth, groove-driven, vocal-forward",
    keywords: ["r&b", "rnb", "soul", "neo soul", "rhythm and blues"],
  },
  {
    slug: "hip-hop",
    display_name: "Hip-Hop",
    descriptor: "Rap-forward, rhythmic, beat-led",
    keywords: ["hip-hop", "hip hop", "rap", "trap", "drill"],
  },
  {
    slug: "pop",
    display_name: "Pop",
    descriptor: "Melodic, accessible, hook-led",
    keywords: ["pop", "dance pop", "synth pop", "electropop"],
  },
  {
    slug: "rock",
    display_name: "Rock",
    descriptor: "Guitar-led, energetic, live-band feel",
    keywords: ["rock", "punk", "metal", "hard rock", "classic rock"],
  },
  {
    slug: "country-folk",
    display_name: "Country / Folk",
    descriptor: "Story-led, acoustic, rootsy",
    keywords: ["country", "folk", "americana", "bluegrass", "singer-songwriter"],
  },
  {
    slug: "global-latin",
    display_name: "Global / Latin",
    descriptor: "Regional scenes, rhythmic and cross-cultural",
    keywords: ["latin", "reggaeton", "salsa", "bachata", "afrobeats", "world"],
  },
  {
    slug: "other",
    display_name: "Other",
    descriptor: "Unclassified or hybrid sounds",
    keywords: [],
  },
];

type ScoredRelease = {
  track: PairTrack;
  confidence: number;
  reason: string;
  mappedGenre: CuratedGenre;
};

function getWeekFriday(): string {
  const now = new Date();
  const phoenixOffsetMinutes = -7 * 60;
  const phoenixNow = new Date(now.getTime() + (now.getTimezoneOffset() + phoenixOffsetMinutes) * 60000);

  const dayOfWeek = phoenixNow.getDay();
  const daysToSubtract = (dayOfWeek - 5 + 7) % 7;

  const friday = new Date(phoenixNow);
  friday.setDate(phoenixNow.getDate() - daysToSubtract);

  const year = friday.getFullYear();
  const month = String(friday.getMonth() + 1).padStart(2, "0");
  const day = String(friday.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeGenres(genres?: string[]): string[] {
  return (genres || []).map((g) => g.toLowerCase().trim()).filter(Boolean);
}

function canonicalGenreToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[\/_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getArtistKey(track: PairTrack): string {
  return (track.artist_name || "")
    .toLowerCase()
    .replace(/\s+(feat\.|featuring|ft\.).*$/i, "")
    .replace(/\s*&\s+.*$/i, "")
    .replace(/\s+x\s+.*$/i, "")
    .replace(/\s+and\s+.*$/i, "")
    .replace(/[|,;].*$/, "")
    .trim();
}

function matchesGenreKeyword(trackGenre: string, preferredGenre: string): boolean {
  const a = canonicalGenreToken(trackGenre);
  const b = canonicalGenreToken(preferredGenre);
  if (!a || !b) return false;
  return (
    a.includes(b) ||
    b.includes(a)
  );
}

function getPreferredBroadGenreSlugs(preferredGenres: string[]): string[] {
  if (!preferredGenres.length) return [];

  const normalized = preferredGenres.map((g) => g.toLowerCase().trim()).filter(Boolean);
  const slugs: string[] = [];

  for (const broad of BROAD_GENRES) {
    if (broad.slug === "other") continue;
    const matched = normalized.some((pg) =>
      matchesGenreKeyword(broad.slug, pg) ||
      matchesGenreKeyword(broad.display_name.toLowerCase(), pg) ||
      broad.keywords.some((kw) => matchesGenreKeyword(kw, pg))
    );
    if (matched) slugs.push(broad.slug);
  }

  return Array.from(new Set(slugs));
}

async function ensureCuratedGenres(): Promise<CuratedGenre[]> {
  const upserts = BROAD_GENRES.map((g, index) => ({
    slug: g.slug,
    display_name: g.display_name,
    descriptor: g.descriptor,
    search_keywords: g.keywords,
    is_active: true,
    sort_order: index,
  }));

  await supabase.from("curated_genres").upsert(upserts, { onConflict: "slug" });

  const { data } = await supabase
    .from("curated_genres")
    .select("*")
    .eq("is_active", true)
    .order("sort_order");

  return (data || []) as CuratedGenre[];
}

function mapTrackToGenre(track: PairTrack, genreBySlug: Map<string, CuratedGenre>): CuratedGenre {
  const trackGenres = normalizeGenres(track.genres);

  for (const broad of BROAD_GENRES) {
    if (broad.slug === "other") continue;

    const matched = trackGenres.some((tg) =>
      broad.keywords.some((kw) => matchesGenreKeyword(tg, kw))
    );

    if (matched) {
      const mapped = genreBySlug.get(broad.slug);
      if (mapped) return mapped;
    }
  }

  return (
    genreBySlug.get("other") || {
      id: "other",
      slug: "other",
      display_name: "Other",
      descriptor: "Unclassified",
      search_keywords: [],
      is_active: true,
    }
  );
}

async function getUserPreferredGenres(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("user_genre_preferences")
    .select("weight,is_active,curated_genres(slug,display_name)")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("weight", { ascending: false });

  if (error || !data) return [];

  const preferred: string[] = [];
  for (const row of data as any[]) {
    const slug = row?.curated_genres?.slug as string | undefined;
    const displayName = row?.curated_genres?.display_name as string | undefined;

    if (slug) preferred.push(slug.toLowerCase());
    if (displayName) preferred.push(displayName.toLowerCase());
  }

  return Array.from(new Set(preferred));
}

async function getExclusionSet(userId: string): Promise<Set<string>> {
  const excluded = new Set<string>();

  const { data: owned } = await supabase
    .from("user_owned_tracks")
    .select("apple_music_id")
    .eq("user_id", userId);

  for (const row of owned || []) {
    if (row.apple_music_id) excluded.add(row.apple_music_id);
  }

  const { data: disliked } = await supabase
    .from("user_disliked_tracks")
    .select("apple_music_id")
    .eq("user_id", userId);

  for (const row of disliked || []) {
    if (row.apple_music_id) excluded.add(row.apple_music_id);
  }

  const { data: surfaced } = await supabase
    .from("weekly_drop_tracks")
    .select("pair_tracks!inner(apple_music_id),weekly_drops!inner(user_id)")
    .eq("weekly_drops.user_id", userId);

  for (const row of surfaced || []) {
    const track = row.pair_tracks as unknown as { apple_music_id?: string };
    if (track?.apple_music_id) excluded.add(track.apple_music_id);
  }

  return excluded;
}

async function getTopArtists(userId: string): Promise<Set<string>> {
  const counts: Record<string, number> = {};

  const { data: owned } = await supabase
    .from("user_owned_tracks")
    .select("pair_tracks(artist_name)")
    .eq("user_id", userId)
    .limit(500);

  for (const row of owned || []) {
    const artist = ((row as any).pair_tracks?.artist_name || "").toLowerCase().trim();
    if (!artist) continue;
    counts[artist] = (counts[artist] || 0) + 4;
  }

  const { data: interactions } = await supabase
    .from("pairing_interactions")
    .select("pair_tracks(artist_name),interaction_type")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(600);

  for (const row of interactions || []) {
    const artist = ((row as any).pair_tracks?.artist_name || "").toLowerCase().trim();
    const interactionType = ((row as any).interaction_type || "") as string;
    if (!artist) continue;

    let weight = 1;
    if (interactionType === "saved" || interactionType === "liked") weight = 3;
    if (interactionType === "preview_completed") weight = 2;
    if (interactionType === "disliked") weight = -2;

    counts[artist] = (counts[artist] || 0) + weight;
  }

  const top = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 80)
    .filter(([, score]) => score > 0)
    .map(([artist]) => artist);

  return new Set(top);
}

function scoreTrack(
  track: PairTrack,
  topArtists: Set<string>,
  preferredGenres: string[],
  mappedGenre: CuratedGenre
): { confidence: number; reason: string } {
  let confidence = 0.45;
  const artistKey = getArtistKey(track);
  const trackGenres = normalizeGenres(track.genres);

  let reason = "New release aligned with your listening";

  if (topArtists.has(artistKey)) {
    confidence += 0.3;
    reason = `New release from ${track.artist_name}, based on your listening history`;
  }

  if (preferredGenres.length > 0) {
    const hasGenreMatch = trackGenres.some((tg) =>
      preferredGenres.some((pg) => matchesGenreKeyword(tg, pg))
    );
    if (hasGenreMatch) {
      confidence += 0.15;
      if (!topArtists.has(artistKey)) {
        reason = `New ${mappedGenre.display_name} release matched to your taste settings`;
      }
    }
  }

  if (track.preview_url) confidence += 0.05;
  if (track.release_date) confidence += 0.05;

  return {
    confidence: Math.min(0.95, confidence),
    reason,
  };
}

async function upsertPairTrack(track: PairTrack): Promise<string | null> {
  const { data: existing } = await supabase
    .from("pair_tracks")
    .select("id")
    .eq("apple_music_id", track.apple_music_id)
    .single();

  if (existing?.id) return existing.id;

  const { data: inserted, error } = await supabase
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
    })
    .select("id")
    .single();

  if (error || !inserted?.id) {
    console.error("[Curator] Failed to upsert pair_track", error);
    return null;
  }

  return inserted.id;
}

function selectTracksByGenre(
  scored: ScoredRelease[],
  preferredGenres: string[]
): ScoredRelease[] {
  const grouped: Record<string, ScoredRelease[]> = {};
  for (const candidate of scored) {
    const slug = candidate.mappedGenre.slug || "other";
    if (!grouped[slug]) grouped[slug] = [];
    grouped[slug].push(candidate);
  }

  const preferredSlugs = getPreferredBroadGenreSlugs(preferredGenres);

  let targetSlugs = preferredSlugs;

  if (targetSlugs.length === 0) {
    targetSlugs = Object.entries(grouped)
      .filter(([slug]) => slug !== "other")
      .sort((a, b) => b[1].length - a[1].length)
      .map(([slug]) => slug);
  }

  const selected: ScoredRelease[] = [];
  const globalArtistCounts: Record<string, number> = {};

  for (const slug of targetSlugs) {
    const candidates = grouped[slug] || [];
    if (!candidates.length) continue;

    const genrePicks: ScoredRelease[] = [];
    const artistCounts: Record<string, number> = {};

    for (const candidate of candidates) {
      if (genrePicks.length >= MAX_TRACKS_PER_GENRE) break;
      const artistKey = getArtistKey(candidate.track);
      const globalCount = globalArtistCounts[artistKey] || 0;
      if (globalCount >= MAX_TRACKS_PER_ARTIST_GLOBAL) continue;
      const count = artistCounts[artistKey] || 0;
      if (count >= MAX_TRACKS_PER_ARTIST_PER_GENRE) continue;
      genrePicks.push(candidate);
      artistCounts[artistKey] = count + 1;
      globalArtistCounts[artistKey] = globalCount + 1;
    }

    // If artist cap prevents us from getting enough tracks, relax it for this genre.
    if (genrePicks.length < MIN_TRACKS_PER_GENRE) {
      for (const candidate of candidates) {
        if (genrePicks.length >= MIN_TRACKS_PER_GENRE) break;
        if (genrePicks.some((p) => p.track.apple_music_id === candidate.track.apple_music_id)) continue;
        const artistKey = getArtistKey(candidate.track);
        const globalCount = globalArtistCounts[artistKey] || 0;
        if (globalCount >= MAX_TRACKS_PER_ARTIST_GLOBAL) continue;
        genrePicks.push(candidate);
        globalArtistCounts[artistKey] = globalCount + 1;
      }
    }

    selected.push(...genrePicks);
  }

  return selected;
}

export async function generateWeeklyDrop(userId: string, preferredGenres?: string[]): Promise<WeeklyDrop | null> {
  const weekStartDate = getWeekFriday();

  const requestPreferredGenres = (preferredGenres || [])
    .map((g) => g.toLowerCase().trim())
    .filter(Boolean);

  const [storedPreferredGenres] = await Promise.all([getUserPreferredGenres(userId)]);
  const mergedPreferredGenres = Array.from(new Set([...requestPreferredGenres, ...storedPreferredGenres]));

  const { data: existingGenerated } = await supabase
    .from("weekly_drops")
    .select("*")
    .eq("user_id", userId)
    .eq("week_start_date", weekStartDate)
    .eq("status", "generated")
    .single();

  if (existingGenerated) return existingGenerated as WeeklyDrop;

  const { data: drop, error: dropError } = await supabase
    .from("weekly_drops")
    .upsert(
      {
        user_id: userId,
        week_start_date: weekStartDate,
        status: "generating",
      },
      { onConflict: "user_id,week_start_date" }
    )
    .select("*")
    .single();

  if (dropError || !drop) {
    console.error("[Curator] Failed to create weekly drop", dropError);
    return null;
  }

  try {
    const [genres, exclusions, topArtists] = await Promise.all([
      ensureCuratedGenres(),
      getExclusionSet(userId),
      getTopArtists(userId),
    ]);

    const genreBySlug = new Map(genres.map((g) => [g.slug, g]));

    const releases = await getAppleMusicNewReleases(400);
    console.log(`[Curator] user=${userId} week=${weekStartDate} releases=${releases.length}`);

    if (releases.length === 0) {
      await supabase.from("weekly_drops").update({ status: "empty", total_tracks: 0 }).eq("id", drop.id);
      return { ...(drop as WeeklyDrop), status: "empty", total_tracks: 0 };
    }

    const filtered = releases.filter((track) => !exclusions.has(track.apple_music_id));

    console.log(
      `[Curator] user=${userId} week=${weekStartDate} filtered=${filtered.length} excluded=${releases.length - filtered.length}`
    );

    if (filtered.length === 0) {
      await supabase.from("weekly_drops").update({ status: "empty", total_tracks: 0 }).eq("id", drop.id);
      return { ...(drop as WeeklyDrop), status: "empty", total_tracks: 0 };
    }

    const scored: ScoredRelease[] = filtered
      .map((track) => {
        const mappedGenre = mapTrackToGenre(track, genreBySlug);
        const { confidence, reason } = scoreTrack(track, topArtists, mergedPreferredGenres, mappedGenre);
        return {
          track,
          confidence,
          reason,
          mappedGenre,
        };
      })
      .sort((a, b) => b.confidence - a.confidence);

    const selected = selectTracksByGenre(scored, mergedPreferredGenres);

    if (selected.length === 0) {
      await supabase.from("weekly_drops").update({ status: "empty", total_tracks: 0 }).eq("id", drop.id);
      return { ...(drop as WeeklyDrop), status: "empty", total_tracks: 0 };
    }

    await supabase.from("weekly_drop_tracks").delete().eq("weekly_drop_id", drop.id);

    let inserted = 0;
    const positionByGenre: Record<string, number> = {};

    for (let i = 0; i < selected.length; i++) {
      const candidate = selected[i];
      const trackId = await upsertPairTrack(candidate.track);
      if (!trackId) continue;

      const genreSlug = candidate.mappedGenre.slug || "other";
      const nextPosition = (positionByGenre[genreSlug] || 0) + 1;
      positionByGenre[genreSlug] = nextPosition;

      const { error: insertError } = await supabase
        .from("weekly_drop_tracks")
        .upsert(
          {
            weekly_drop_id: drop.id,
            genre_id: candidate.mappedGenre.id,
            track_id: trackId,
            position: nextPosition,
            confidence: candidate.confidence,
            audio_sim: candidate.confidence,
            text_sim: candidate.confidence,
            scene_sim: candidate.confidence,
            reason: candidate.reason,
          },
          { onConflict: "weekly_drop_id,genre_id,position" }
        );

      if (!insertError) inserted += 1;
      else console.error("[Curator] insert weekly_drop_track failed", insertError);
    }

    const status = inserted > 0 ? "generated" : "empty";
    await supabase.from("weekly_drops").update({ status, total_tracks: inserted }).eq("id", drop.id);

    console.log(`[Curator] user=${userId} week=${weekStartDate} selected=${selected.length} inserted=${inserted}`);

    return {
      ...(drop as WeeklyDrop),
      status: status as WeeklyDrop["status"],
      total_tracks: inserted,
    };
  } catch (error) {
    console.error("[Curator] generateWeeklyDrop failed", error);
    await supabase.from("weekly_drops").update({ status: "failed" }).eq("id", drop.id);
    return null;
  }
}

export async function getCurrentWeeklyDrop(
  userId: string,
  preferredGenres?: string[],
  forceRefresh?: boolean
): Promise<{
  drop: WeeklyDrop | null;
  tracks: WeeklyDropTrack[];
  genres: Record<string, WeeklyDropTrack[]>;
}> {
  const weekStartDate = getWeekFriday();

  if (forceRefresh) {
    const { data: existing } = await supabase
      .from("weekly_drops")
      .select("id")
      .eq("user_id", userId)
      .eq("week_start_date", weekStartDate)
      .single();

    if (existing?.id) {
      await supabase.from("weekly_drop_tracks").delete().eq("weekly_drop_id", existing.id);
      await supabase.from("weekly_drops").delete().eq("id", existing.id);
    }
  }

  let { data: drop } = await supabase
    .from("weekly_drops")
    .select("*")
    .eq("user_id", userId)
    .eq("week_start_date", weekStartDate)
    .single();

  if (!drop) {
    drop = (await generateWeeklyDrop(userId, preferredGenres)) as WeeklyDrop | null;
  }

  if (!drop) {
    return { drop: null, tracks: [], genres: {} };
  }

  const { data: rows } = await supabase
    .from("weekly_drop_tracks")
    .select(`
      *,
      pair_tracks(*),
      curated_genres(*)
    `)
    .eq("weekly_drop_id", drop.id)
    .order("position", { ascending: true });

  const tracks: WeeklyDropTrack[] = (rows || []).map((r: any) => ({
    id: r.id,
    weekly_drop_id: r.weekly_drop_id,
    genre_id: r.genre_id,
    track_id: r.track_id,
    position: r.position,
    confidence: r.confidence,
    audio_sim: r.audio_sim,
    text_sim: r.text_sim,
    scene_sim: r.scene_sim,
    reason: r.reason,
    track: r.pair_tracks as PairTrack,
    genre: r.curated_genres as CuratedGenre,
  }));

  const grouped: Record<string, WeeklyDropTrack[]> = {};
  for (const track of tracks) {
    const slug = track.genre?.slug || "other";
    if (!grouped[slug]) grouped[slug] = [];
    grouped[slug].push(track);
  }

  return {
    drop: drop as WeeklyDrop,
    tracks,
    genres: grouped,
  };
}

export async function getCuratedGenres(): Promise<CuratedGenre[]> {
  return ensureCuratedGenres();
}

export async function logInteraction(
  userId: string,
  trackId: string,
  interactionType: string,
  weeklyDropId?: string,
  previewDurationMs?: number,
  context?: string
): Promise<void> {
  await supabase.from("pairing_interactions").insert({
    user_id: userId,
    track_id: trackId,
    weekly_drop_id: weeklyDropId,
    interaction_type: interactionType,
    preview_duration_ms: previewDurationMs,
    context,
  });

  if (interactionType === "liked" || interactionType === "saved") {
    await updateTasteFromInteraction(userId, trackId, true);
  } else if (interactionType === "disliked") {
    await updateTasteFromInteraction(userId, trackId, false);

    const { data: track } = await supabase
      .from("pair_tracks")
      .select("apple_music_id")
      .eq("id", trackId)
      .single();

    if (track?.apple_music_id) {
      await supabase
        .from("user_disliked_tracks")
        .upsert(
          {
            user_id: userId,
            track_id: trackId,
            apple_music_id: track.apple_music_id,
          },
          { onConflict: "user_id,apple_music_id" }
        );
    }
  }
}

async function updateTasteFromInteraction(userId: string, trackId: string, positive: boolean): Promise<void> {
  const { data: track } = await supabase
    .from("pair_tracks")
    .select("energy,valence,danceability,acousticness,tempo")
    .eq("id", trackId)
    .single();

  if (!track) return;

  const { data: current } = await supabase
    .from("user_taste_vectors")
    .select("*")
    .eq("user_id", userId)
    .single();

  const rate = positive ? 0.1 : -0.05;

  await supabase.from("user_taste_vectors").upsert(
    {
      user_id: userId,
      preferred_energy: lerp(current?.preferred_energy ?? 0.5, track.energy ?? 0.5, rate),
      preferred_valence: lerp(current?.preferred_valence ?? 0.5, track.valence ?? 0.5, rate),
      preferred_danceability: lerp(current?.preferred_danceability ?? 0.5, track.danceability ?? 0.5, rate),
      preferred_acousticness: lerp(current?.preferred_acousticness ?? 0.5, track.acousticness ?? 0.5, rate),
      preferred_tempo: lerp(current?.preferred_tempo ?? 120, track.tempo ?? 120, rate),
      positive_track_count: (current?.positive_track_count ?? 0) + (positive ? 1 : 0),
      negative_track_count: (current?.negative_track_count ?? 0) + (positive ? 0 : 1),
      computed_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
}

function lerp(current: number, target: number, t: number): number {
  const clamped = Math.max(-1, Math.min(1, t));
  return current + (target - current) * clamped;
}
