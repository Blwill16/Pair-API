// Pair Curator Engine v1
// "Pair is not a recommender feed. It's a high-precision curator."
// Weekly drops by genre with confidence-gated recommendations

import { supabase } from "./supabase";
import { PairTrack, searchAppleMusicTracks, getAppleMusicTrack } from "./appleMusic";

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

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
  status: 'pending' | 'generating' | 'generated' | 'empty' | 'failed';
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

export interface ScoredCandidate {
  track: PairTrack;
  confidence: number;
  audio_sim: number;
  text_sim: number;
  scene_sim: number;
  reason: string;
}

export interface UserTasteProfile {
  preferred_energy: number;
  preferred_valence: number;
  preferred_danceability: number;
  preferred_acousticness: number;
  preferred_tempo: number;
  preferred_genres: Record<string, number>;
  audio_centroid: Record<string, number> | null;
  audio_spread: Record<string, number> | null;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_CONFIDENCE_THRESHOLD = 0.84;
const STRICT_CONFIDENCE_THRESHOLD = 0.90; // For users with little data
const ADVENTURE_CONFIDENCE_THRESHOLD = 0.78;
const MAX_TRACKS_PER_GENRE = 5;

// Scoring weights
const WEIGHTS = {
  audio: 0.45,
  text: 0.30,
  scene: 0.25
};

// Genre family mappings for scene similarity
const GENRE_FAMILIES: Record<string, string[]> = {
  electronic: ['electronic', 'edm', 'dance', 'house', 'techno', 'trance', 'melodic', 'progressive', 'deep house', 'tech house', 'minimal', 'ambient'],
  indie: ['indie', 'alternative', 'indie rock', 'indie pop', 'indie folk', 'indie dance'],
  rnb: ['r&b', 'rnb', 'soul', 'neo soul', 'alternative r&b', 'contemporary r&b'],
  rock: ['rock', 'post-rock', 'shoegaze', 'dream pop', 'alternative rock', 'indie rock'],
  hiphop: ['hip-hop', 'hip hop', 'rap', 'trap', 'drill'],
  jazz: ['jazz', 'jazz fusion', 'nu jazz', 'contemporary jazz'],
  folk: ['folk', 'indie folk', 'americana', 'singer-songwriter'],
  pop: ['pop', 'synth pop', 'electropop', 'art pop', 'dream pop']
};

// ============================================================================
// CANDIDATE RETRIEVAL
// ============================================================================

/**
 * Retrieve weekly candidates for a genre from Apple Music
 * Sources: new releases, charts, editorial playlists, related artists
 */
export async function retrieveWeeklyCandidates(
  genre: CuratedGenre,
  weekStartDate: string
): Promise<PairTrack[]> {
  const candidates: Map<string, PairTrack> = new Map();
  
  console.log(`[Curator] Retrieving candidates for genre: ${genre.display_name}`);
  
  // 1. Search for new releases using genre keywords
  for (const keyword of genre.search_keywords.slice(0, 3)) {
    try {
      const searchResults = await searchAppleMusicTracks(`${keyword} new`, 25);
      for (const track of searchResults) {
        if (!candidates.has(track.apple_music_id)) {
          candidates.set(track.apple_music_id, track);
        }
      }
    } catch (error) {
      console.error(`[Curator] Error searching for "${keyword}":`, error);
    }
  }
  
  // 2. Search for genre + recent year
  const currentYear = new Date().getFullYear();
  try {
    const recentResults = await searchAppleMusicTracks(
      `${genre.search_keywords[0]} ${currentYear}`, 
      25
    );
    for (const track of recentResults) {
      if (!candidates.has(track.apple_music_id)) {
        candidates.set(track.apple_music_id, track);
      }
    }
  } catch (error) {
    console.error(`[Curator] Error searching recent releases:`, error);
  }
  
  // 3. Search for genre + "best" or "top" for quality signals
  try {
    const topResults = await searchAppleMusicTracks(
      `best ${genre.search_keywords[0]}`,
      25
    );
    for (const track of topResults) {
      if (!candidates.has(track.apple_music_id)) {
        candidates.set(track.apple_music_id, track);
      }
    }
  } catch (error) {
    console.error(`[Curator] Error searching top tracks:`, error);
  }
  
  // Store candidates in database
  const candidateArray = Array.from(candidates.values());
  await storeCandidates(candidateArray, genre.id, weekStartDate);
  
  console.log(`[Curator] Retrieved ${candidateArray.length} candidates for ${genre.display_name}`);
  return candidateArray;
}

/**
 * Store candidates in weekly_candidates table
 */
async function storeCandidates(
  tracks: PairTrack[],
  genreId: string,
  weekStartDate: string
): Promise<void> {
  for (const track of tracks) {
    // First ensure track exists in pair_tracks
    const { data: existingTrack } = await supabase
      .from('pair_tracks')
      .select('id')
      .eq('apple_music_id', track.apple_music_id)
      .single();
    
    let trackId: string;
    
    if (existingTrack) {
      trackId = existingTrack.id;
    } else {
      const { data: newTrack, error } = await supabase
        .from('pair_tracks')
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
          tempo: track.tempo
        })
        .select('id')
        .single();
      
      if (error || !newTrack) {
        console.error(`[Curator] Error inserting track:`, error);
        continue;
      }
      trackId = newTrack.id;
    }
    
    // Insert into weekly_candidates (ignore duplicates)
    await supabase
      .from('weekly_candidates')
      .upsert({
        week_start_date: weekStartDate,
        genre_id: genreId,
        track_id: trackId,
        source: 'new_release',
        source_detail: track.genres?.join(', ')
      }, {
        onConflict: 'week_start_date,genre_id,track_id'
      });
  }
}

// ============================================================================
// SCORING MODEL
// ============================================================================

/**
 * Compute audio similarity between candidate and user taste profile
 * Uses z-score distance from user centroid, scaled by spread
 */
function computeAudioSimilarity(
  track: PairTrack,
  userTaste: UserTasteProfile
): number {
  const features = [
    { name: 'energy', trackVal: track.energy, userVal: userTaste.preferred_energy, weight: 1.0 },
    { name: 'valence', trackVal: track.valence, userVal: userTaste.preferred_valence, weight: 0.8 },
    { name: 'danceability', trackVal: track.danceability, userVal: userTaste.preferred_danceability, weight: 0.9 },
    { name: 'acousticness', trackVal: track.acousticness, userVal: userTaste.preferred_acousticness, weight: 0.6 },
    { name: 'tempo', trackVal: track.tempo ? track.tempo / 200 : 0.5, userVal: userTaste.preferred_tempo / 200, weight: 0.5 }
  ];
  
  let totalDistance = 0;
  let totalWeight = 0;
  
  for (const f of features) {
    const trackVal = f.trackVal ?? 0.5;
    const userVal = f.userVal ?? 0.5;
    const spread = userTaste.audio_spread?.[f.name] ?? 0.2;
    
    // Z-score distance
    const distance = Math.abs(trackVal - userVal) / Math.max(spread, 0.1);
    totalDistance += distance * f.weight;
    totalWeight += f.weight;
  }
  
  // Convert distance to similarity (0-1)
  const avgDistance = totalDistance / totalWeight;
  return Math.exp(-avgDistance * 0.5);
}

/**
 * Compute text similarity using genre and metadata overlap
 */
function computeTextSimilarity(
  track: PairTrack,
  userTaste: UserTasteProfile,
  genreKeywords: string[]
): number {
  let score = 0;
  let factors = 0;
  
  // Genre keyword match
  const trackGenres = (track.genres || []).map(g => g.toLowerCase());
  const matchedKeywords = genreKeywords.filter(kw => 
    trackGenres.some(g => g.includes(kw.toLowerCase()))
  );
  
  if (genreKeywords.length > 0) {
    score += (matchedKeywords.length / genreKeywords.length) * 0.6;
    factors += 0.6;
  }
  
  // User preferred genres match
  const userGenres = Object.keys(userTaste.preferred_genres || {});
  if (userGenres.length > 0) {
    const userGenreMatch = userGenres.filter(ug =>
      trackGenres.some(tg => tg.includes(ug.toLowerCase()))
    );
    score += (userGenreMatch.length / userGenres.length) * 0.4;
    factors += 0.4;
  }
  
  return factors > 0 ? score / factors : 0.5;
}

/**
 * Compute scene similarity (cultural adjacency)
 * Based on genre families, era, and co-occurrence signals
 */
function computeSceneSimilarity(
  track: PairTrack,
  userTaste: UserTasteProfile,
  genreKeywords: string[]
): number {
  let score = 0;
  let factors = 0;
  
  // Genre family match
  const trackGenres = (track.genres || []).map(g => g.toLowerCase());
  const targetFamilies = new Set<string>();
  
  for (const keyword of genreKeywords) {
    for (const [family, keywords] of Object.entries(GENRE_FAMILIES)) {
      if (keywords.some(k => keyword.toLowerCase().includes(k))) {
        targetFamilies.add(family);
      }
    }
  }
  
  const trackFamilies = new Set<string>();
  for (const genre of trackGenres) {
    for (const [family, keywords] of Object.entries(GENRE_FAMILIES)) {
      if (keywords.some(k => genre.includes(k))) {
        trackFamilies.add(family);
      }
    }
  }
  
  if (targetFamilies.size > 0) {
    const familyOverlap = [...targetFamilies].filter(f => trackFamilies.has(f)).length;
    score += (familyOverlap / targetFamilies.size) * 0.5;
    factors += 0.5;
  }
  
  // Era similarity (prefer recent releases)
  if (track.release_date) {
    const releaseYear = parseInt(track.release_date.substring(0, 4));
    const currentYear = new Date().getFullYear();
    const yearDiff = currentYear - releaseYear;
    
    // Prefer tracks from last 3 years, decay after
    if (yearDiff <= 3) {
      score += 0.3;
    } else if (yearDiff <= 10) {
      score += 0.3 * (1 - (yearDiff - 3) / 7);
    }
    factors += 0.3;
  }
  
  // Artist diversity bonus (not same artist repeatedly)
  score += 0.2; // Base score, will be adjusted by deduplication
  factors += 0.2;
  
  return factors > 0 ? score / factors : 0.3;
}

/**
 * Score a candidate track against user taste
 */
export function scoreCandidate(
  track: PairTrack,
  userTaste: UserTasteProfile,
  genreKeywords: string[]
): ScoredCandidate {
  const audioSim = computeAudioSimilarity(track, userTaste);
  const textSim = computeTextSimilarity(track, userTaste, genreKeywords);
  const sceneSim = computeSceneSimilarity(track, userTaste, genreKeywords);
  
  // Weighted combination
  const confidence = 
    WEIGHTS.audio * audioSim +
    WEIGHTS.text * textSim +
    WEIGHTS.scene * sceneSim;
  
  // Generate explanation
  const reason = generateExplanation(track, audioSim, textSim, sceneSim, genreKeywords);
  
  return {
    track,
    confidence,
    audio_sim: audioSim,
    text_sim: textSim,
    scene_sim: sceneSim,
    reason
  };
}

/**
 * Generate "Why Pair spoke up" explanation
 */
function generateExplanation(
  track: PairTrack,
  audioSim: number,
  textSim: number,
  sceneSim: number,
  genreKeywords: string[]
): string {
  const explanations: string[] = [];
  
  // Determine dominant factor
  const maxSim = Math.max(audioSim, textSim, sceneSim);
  
  if (audioSim === maxSim && audioSim > 0.6) {
    if (track.energy && track.energy > 0.7) {
      explanations.push(`Matches your energy preferences with similar intensity`);
    } else if (track.valence && track.valence > 0.6) {
      explanations.push(`Similar mood and emotional tone to your recent saves`);
    } else {
      explanations.push(`Sonic profile aligns with your listening patterns`);
    }
  }
  
  if (textSim === maxSim && textSim > 0.6) {
    const matchedGenre = genreKeywords.find(kw => 
      track.genres?.some(g => g.toLowerCase().includes(kw.toLowerCase()))
    );
    if (matchedGenre) {
      explanations.push(`Strong ${matchedGenre} credentials`);
    } else {
      explanations.push(`Genre tags align with your taste profile`);
    }
  }
  
  if (sceneSim === maxSim && sceneSim > 0.6) {
    if (track.release_date) {
      const year = track.release_date.substring(0, 4);
      explanations.push(`Fresh release from ${year} in your wheelhouse`);
    } else {
      explanations.push(`From the same musical circles you frequent`);
    }
  }
  
  // Fallback
  if (explanations.length === 0) {
    explanations.push(`Fits your ${genreKeywords[0] || 'music'} taste profile`);
  }
  
  return explanations[0];
}

// ============================================================================
// WEEKLY DROP GENERATION
// ============================================================================

/**
 * Get user's taste profile from database
 */
async function getUserTasteProfile(userId: string): Promise<UserTasteProfile> {
  const { data } = await supabase
    .from('user_taste_vectors')
    .select('*')
    .eq('user_id', userId)
    .single();
  
  if (data) {
    return {
      preferred_energy: data.preferred_energy ?? 0.5,
      preferred_valence: data.preferred_valence ?? 0.5,
      preferred_danceability: data.preferred_danceability ?? 0.5,
      preferred_acousticness: data.preferred_acousticness ?? 0.5,
      preferred_tempo: data.preferred_tempo ?? 120,
      preferred_genres: data.preferred_genres ?? {},
      audio_centroid: data.audio_centroid,
      audio_spread: data.audio_spread
    };
  }
  
  // Default taste profile for new users
  return {
    preferred_energy: 0.5,
    preferred_valence: 0.5,
    preferred_danceability: 0.5,
    preferred_acousticness: 0.5,
    preferred_tempo: 120,
    preferred_genres: {},
    audio_centroid: null,
    audio_spread: null
  };
}

/**
 * Get user's exclusion sets (owned, disliked, recently shown)
 */
async function getExclusionSets(userId: string): Promise<Set<string>> {
  const excluded = new Set<string>();
  
  // Owned tracks
  const { data: owned } = await supabase
    .from('user_owned_tracks')
    .select('apple_music_id')
    .eq('user_id', userId);
  
  if (owned) {
    for (const t of owned) {
      excluded.add(t.apple_music_id);
    }
  }
  
  // Disliked tracks
  const { data: disliked } = await supabase
    .from('user_disliked_tracks')
    .select('apple_music_id')
    .eq('user_id', userId);
  
  if (disliked) {
    for (const t of disliked) {
      excluded.add(t.apple_music_id);
    }
  }
  
  // Recently shown (last 4 weeks)
  const fourWeeksAgo = new Date();
  fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
  
  const { data: recent } = await supabase
    .from('weekly_drop_tracks')
    .select(`
      track_id,
      pair_tracks!inner(apple_music_id),
      weekly_drops!inner(user_id, week_start_date)
    `)
    .eq('weekly_drops.user_id', userId)
    .gte('weekly_drops.week_start_date', fourWeeksAgo.toISOString().split('T')[0]);
  
  if (recent) {
    for (const t of recent) {
      const pairTrack = t.pair_tracks as unknown as { apple_music_id: string };
      if (pairTrack?.apple_music_id) {
        excluded.add(pairTrack.apple_music_id);
      }
    }
  }
  
  return excluded;
}

/**
 * Get confidence threshold for user
 */
async function getConfidenceThreshold(userId: string): Promise<number> {
  const { data: settings } = await supabase
    .from('user_settings')
    .select('confidence_threshold, adventure_mode')
    .eq('user_id', userId)
    .single();
  
  if (settings?.adventure_mode) {
    return ADVENTURE_CONFIDENCE_THRESHOLD;
  }
  
  // Check if user has enough data
  const { data: tasteVector } = await supabase
    .from('user_taste_vectors')
    .select('positive_track_count')
    .eq('user_id', userId)
    .single();
  
  if (!tasteVector || (tasteVector.positive_track_count ?? 0) < 10) {
    return STRICT_CONFIDENCE_THRESHOLD; // Be stricter with new users
  }
  
  return settings?.confidence_threshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
}

/**
 * Generate weekly drop for a user
 */
export async function generateWeeklyDrop(userId: string): Promise<WeeklyDrop | null> {
  const weekStartDate = getWeekFriday();
  
  console.log(`[Curator] Generating weekly drop for user ${userId}, week ${weekStartDate}`);
  
  // Check if drop already exists
  const { data: existingDrop } = await supabase
    .from('weekly_drops')
    .select('*')
    .eq('user_id', userId)
    .eq('week_start_date', weekStartDate)
    .single();
  
  if (existingDrop && existingDrop.status === 'generated') {
    console.log(`[Curator] Drop already exists for this week`);
    return existingDrop as WeeklyDrop;
  }
  
  // Create or update drop record
  const { data: drop, error: dropError } = await supabase
    .from('weekly_drops')
    .upsert({
      user_id: userId,
      week_start_date: weekStartDate,
      status: 'generating'
    }, {
      onConflict: 'user_id,week_start_date'
    })
    .select()
    .single();
  
  if (dropError || !drop) {
    console.error(`[Curator] Error creating drop:`, dropError);
    return null;
  }
  
  try {
    // Get user's active genres
    const { data: genres } = await supabase
      .from('curated_genres')
      .select('*')
      .eq('is_active', true)
      .order('sort_order');
    
    if (!genres || genres.length === 0) {
      console.error(`[Curator] No active genres found`);
      await updateDropStatus(drop.id, 'failed');
      return null;
    }
    
    // Get user taste and exclusions
    const userTaste = await getUserTasteProfile(userId);
    const exclusions = await getExclusionSets(userId);
    const threshold = await getConfidenceThreshold(userId);
    
    console.log(`[Curator] Confidence threshold: ${threshold}`);
    
    let totalTracks = 0;
    
    // Process each genre
    for (const genre of genres) {
      console.log(`[Curator] Processing genre: ${genre.display_name}`);
      
      // Retrieve candidates
      const candidates = await retrieveWeeklyCandidates(genre as CuratedGenre, weekStartDate);
      
      // Filter excluded tracks
      const filteredCandidates = candidates.filter(c => !exclusions.has(c.apple_music_id));
      
      // Score candidates
      const scored = filteredCandidates.map(track => 
        scoreCandidate(track, userTaste, genre.search_keywords || [])
      );
      
      // Sort by confidence and filter by threshold
      const qualified = scored
        .filter(s => s.confidence >= threshold)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, MAX_TRACKS_PER_GENRE);
      
      console.log(`[Curator] ${genre.display_name}: ${qualified.length} tracks passed threshold`);
      
      // Store qualified tracks
      for (let i = 0; i < qualified.length; i++) {
        const scored = qualified[i];
        
        // Get track_id from pair_tracks
        const { data: pairTrack } = await supabase
          .from('pair_tracks')
          .select('id')
          .eq('apple_music_id', scored.track.apple_music_id)
          .single();
        
        if (!pairTrack) continue;
        
        await supabase
          .from('weekly_drop_tracks')
          .insert({
            weekly_drop_id: drop.id,
            genre_id: genre.id,
            track_id: pairTrack.id,
            position: i + 1,
            confidence: scored.confidence,
            audio_sim: scored.audio_sim,
            text_sim: scored.text_sim,
            scene_sim: scored.scene_sim,
            reason: scored.reason
          });
        
        totalTracks++;
      }
    }
    
    // Update drop status
    const finalStatus = totalTracks > 0 ? 'generated' : 'empty';
    await supabase
      .from('weekly_drops')
      .update({
        status: finalStatus,
        total_tracks: totalTracks
      })
      .eq('id', drop.id);
    
    console.log(`[Curator] Weekly drop complete: ${totalTracks} tracks`);
    
    return {
      ...drop,
      status: finalStatus,
      total_tracks: totalTracks
    } as WeeklyDrop;
    
  } catch (error) {
    console.error(`[Curator] Error generating drop:`, error);
    await updateDropStatus(drop.id, 'failed');
    return null;
  }
}

async function updateDropStatus(dropId: string, status: string): Promise<void> {
  await supabase
    .from('weekly_drops')
    .update({ status })
    .eq('id', dropId);
}

/**
 * Get current week's Friday date
 */
function getWeekFriday(): string {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const daysUntilFriday = (5 - dayOfWeek + 7) % 7;
  const friday = new Date(now);
  friday.setDate(now.getDate() + daysUntilFriday);
  return friday.toISOString().split('T')[0];
}

// ============================================================================
// API FUNCTIONS
// ============================================================================

/**
 * Get user's current weekly drop
 */
export async function getCurrentWeeklyDrop(userId: string): Promise<{
  drop: WeeklyDrop | null;
  tracks: WeeklyDropTrack[];
  genres: Record<string, WeeklyDropTrack[]>;
}> {
  const weekStartDate = getWeekFriday();
  
  // Get or generate drop
  let { data: drop } = await supabase
    .from('weekly_drops')
    .select('*')
    .eq('user_id', userId)
    .eq('week_start_date', weekStartDate)
    .single();
  
  if (!drop) {
    // Generate drop if it doesn't exist
    drop = await generateWeeklyDrop(userId) as any;
  }
  
  if (!drop) {
    return { drop: null, tracks: [], genres: {} };
  }
  
  // Get tracks with full details
  const { data: dropTracks } = await supabase
    .from('weekly_drop_tracks')
    .select(`
      *,
      pair_tracks(*),
      curated_genres(*)
    `)
    .eq('weekly_drop_id', drop.id)
    .order('position');
  
  const tracks: WeeklyDropTrack[] = (dropTracks || []).map(dt => ({
    id: dt.id,
    weekly_drop_id: dt.weekly_drop_id,
    genre_id: dt.genre_id,
    track_id: dt.track_id,
    position: dt.position,
    confidence: dt.confidence,
    audio_sim: dt.audio_sim,
    text_sim: dt.text_sim,
    scene_sim: dt.scene_sim,
    reason: dt.reason,
    track: dt.pair_tracks as PairTrack,
    genre: dt.curated_genres as CuratedGenre
  }));
  
  // Group by genre
  const genres: Record<string, WeeklyDropTrack[]> = {};
  for (const track of tracks) {
    const genreSlug = track.genre?.slug || 'unknown';
    if (!genres[genreSlug]) {
      genres[genreSlug] = [];
    }
    genres[genreSlug].push(track);
  }
  
  return {
    drop: drop as WeeklyDrop,
    tracks,
    genres
  };
}

/**
 * Get all curated genres
 */
export async function getCuratedGenres(): Promise<CuratedGenre[]> {
  const { data } = await supabase
    .from('curated_genres')
    .select('*')
    .eq('is_active', true)
    .order('sort_order');
  
  return (data || []) as CuratedGenre[];
}

/**
 * Log a pairing interaction
 */
export async function logInteraction(
  userId: string,
  trackId: string,
  interactionType: string,
  weeklyDropId?: string,
  previewDurationMs?: number,
  context?: string
): Promise<void> {
  await supabase
    .from('pairing_interactions')
    .insert({
      user_id: userId,
      track_id: trackId,
      weekly_drop_id: weeklyDropId,
      interaction_type: interactionType,
      preview_duration_ms: previewDurationMs,
      context
    });
  
  // Update taste vector based on interaction
  if (interactionType === 'liked' || interactionType === 'saved') {
    await updateTasteFromInteraction(userId, trackId, true);
  } else if (interactionType === 'disliked') {
    await updateTasteFromInteraction(userId, trackId, false);
    
    // Add to disliked tracks
    const { data: track } = await supabase
      .from('pair_tracks')
      .select('apple_music_id')
      .eq('id', trackId)
      .single();
    
    if (track) {
      await supabase
        .from('user_disliked_tracks')
        .upsert({
          user_id: userId,
          track_id: trackId,
          apple_music_id: track.apple_music_id
        }, {
          onConflict: 'user_id,apple_music_id'
        });
    }
  }
}

/**
 * Update user taste vector from interaction
 */
async function updateTasteFromInteraction(
  userId: string,
  trackId: string,
  isPositive: boolean
): Promise<void> {
  // Get track features
  const { data: track } = await supabase
    .from('pair_tracks')
    .select('energy, valence, danceability, acousticness, tempo, genres')
    .eq('id', trackId)
    .single();
  
  if (!track) return;
  
  // Get current taste vector
  const { data: currentVector } = await supabase
    .from('user_taste_vectors')
    .select('*')
    .eq('user_id', userId)
    .single();
  
  const learningRate = isPositive ? 0.1 : 0.05;
  const direction = isPositive ? 1 : -1;
  
  const newVector = {
    user_id: userId,
    preferred_energy: lerp(
      currentVector?.preferred_energy ?? 0.5,
      track.energy ?? 0.5,
      learningRate * direction
    ),
    preferred_valence: lerp(
      currentVector?.preferred_valence ?? 0.5,
      track.valence ?? 0.5,
      learningRate * direction
    ),
    preferred_danceability: lerp(
      currentVector?.preferred_danceability ?? 0.5,
      track.danceability ?? 0.5,
      learningRate * direction
    ),
    preferred_acousticness: lerp(
      currentVector?.preferred_acousticness ?? 0.5,
      track.acousticness ?? 0.5,
      learningRate * direction
    ),
    preferred_tempo: lerp(
      currentVector?.preferred_tempo ?? 120,
      track.tempo ?? 120,
      learningRate * direction
    ),
    positive_track_count: (currentVector?.positive_track_count ?? 0) + (isPositive ? 1 : 0),
    negative_track_count: (currentVector?.negative_track_count ?? 0) + (isPositive ? 0 : 1),
    computed_at: new Date().toISOString()
  };
  
  await supabase
    .from('user_taste_vectors')
    .upsert(newVector, { onConflict: 'user_id' });
}

function lerp(current: number, target: number, t: number): number {
  return current + (target - current) * Math.max(-1, Math.min(1, t));
}
