// Pair Curator Engine v2
// "Pair is not a recommender feed. It's a high-precision curator."
// NEW RELEASES FIRST → Score by taste → Assign to genres for display
// Core principle: Only show music released THIS WEEK

import { supabase } from "./supabase";
import { 
  PairTrack, 
  searchAppleMusicTracks, 
  getAppleMusicTrack,
  getAppleMusicNewReleases,
  buildTasteFingerprint,
  scoreNewReleaseCandidate,
  TasteFingerprint,
  CandidateScore
} from "./appleMusic";

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

// V2: Lower thresholds since we're starting with new releases (smaller pool)
const DEFAULT_CONFIDENCE_THRESHOLD = 0.55; // Lower for new releases
const STRICT_CONFIDENCE_THRESHOLD = 0.65; // For users with little data
const ADVENTURE_CONFIDENCE_THRESHOLD = 0.45;

// V2: Total tracks for the week (not per genre)
const MAX_WEEKLY_TRACKS = 6;
const MIN_WEEKLY_TRACKS = 3;

// Legacy scoring weights (kept for backward compatibility)
const WEIGHTS = {
  audio: 0.45,
  text: 0.30,
  scene: 0.25
};

// ============================================================================
// BROAD GENRES (8-12 max) - Used for display, not discovery
// Discovery happens first, then we assign to these genres
// ============================================================================

export interface BroadGenre {
  slug: string;
  display_name: string;
  keywords: string[];  // Used to match track genres to this broad genre
}

const BROAD_GENRES: BroadGenre[] = [
  {
    slug: 'electronic',
    display_name: 'Electronic',
    keywords: ['electronic', 'edm', 'dance', 'house', 'techno', 'trance', 'melodic', 'progressive', 'deep house', 'tech house', 'minimal', 'ambient', 'electronica', 'synth']
  },
  {
    slug: 'indie-alternative',
    display_name: 'Indie / Alternative',
    keywords: ['indie', 'alternative', 'indie rock', 'indie pop', 'indie folk', 'indie dance', 'alt']
  },
  {
    slug: 'rnb-soul',
    display_name: 'R&B / Soul',
    keywords: ['r&b', 'rnb', 'soul', 'neo soul', 'alternative r&b', 'contemporary r&b', 'rhythm and blues']
  },
  {
    slug: 'hip-hop',
    display_name: 'Hip-Hop',
    keywords: ['hip-hop', 'hip hop', 'rap', 'trap', 'drill', 'hiphop']
  },
  {
    slug: 'pop',
    display_name: 'Pop',
    keywords: ['pop', 'synth pop', 'electropop', 'art pop', 'dream pop', 'dance pop']
  },
  {
    slug: 'rock',
    display_name: 'Rock',
    keywords: ['rock', 'post-rock', 'shoegaze', 'alternative rock', 'hard rock', 'punk', 'metal']
  },
  {
    slug: 'ambient-experimental',
    display_name: 'Ambient / Experimental',
    keywords: ['ambient', 'experimental', 'avant-garde', 'noise', 'drone', 'soundscape']
  },
  {
    slug: 'folk-singer-songwriter',
    display_name: 'Folk / Singer-Songwriter',
    keywords: ['folk', 'indie folk', 'americana', 'singer-songwriter', 'acoustic', 'country']
  },
  {
    slug: 'jazz',
    display_name: 'Jazz',
    keywords: ['jazz', 'jazz fusion', 'nu jazz', 'contemporary jazz', 'bebop', 'smooth jazz']
  },
  {
    slug: 'classical',
    display_name: 'Classical',
    keywords: ['classical', 'orchestral', 'chamber', 'opera', 'symphony', 'piano']
  },
  {
    slug: 'latin',
    display_name: 'Latin',
    keywords: ['latin', 'reggaeton', 'salsa', 'bachata', 'cumbia', 'latin pop', 'spanish']
  },
  {
    slug: 'global',
    display_name: 'Global',
    keywords: ['world', 'afrobeat', 'afropop', 'k-pop', 'j-pop', 'bollywood', 'african']
  }
];

// Legacy genre family mappings (kept for backward compatibility)
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
 * Generate weekly drop for a user - V2 NEW RELEASES FIRST APPROACH
 * 
 * Flow:
 * 1. Fetch NEW RELEASES from Apple Music (this week only)
 * 2. Build user taste fingerprint from saved + recently played
 * 3. Exclude: already in library, disliked, previously shown
 * 4. Score each candidate: artist proximity, vibe match, genre fit, novelty
 * 5. Select 3-6 total tracks (high conviction only)
 * 6. Assign to broad genres for display
 */
export async function generateWeeklyDrop(userId: string): Promise<WeeklyDrop | null> {
  const weekStartDate = getWeekFriday();
  
  console.log(`[Curator V2] Generating weekly drop for user ${userId}, week ${weekStartDate}`);
  console.log(`[Curator V2] NEW RELEASES FIRST approach - only showing this week's music`);
  
  // Check if drop already exists
  const { data: existingDrop } = await supabase
    .from('weekly_drops')
    .select('*')
    .eq('user_id', userId)
    .eq('week_start_date', weekStartDate)
    .single();
  
  if (existingDrop && existingDrop.status === 'generated') {
    console.log(`[Curator V2] Drop already exists for this week`);
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
    console.error(`[Curator V2] Error creating drop:`, dropError);
    return null;
  }
  
  try {
    // ========================================================================
    // STEP 1: FETCH NEW RELEASES (this week only)
    // ========================================================================
    console.log(`[Curator V2] Step 1: Fetching new releases from Apple Music...`);
    const newReleases = await getAppleMusicNewReleases(150);
    console.log(`[Curator V2] Found ${newReleases.length} new releases this week`);
    
    if (newReleases.length === 0) {
      console.log(`[Curator V2] No new releases found - marking as empty`);
      await updateDropStatus(drop.id, 'empty');
      return { ...drop, status: 'empty', total_tracks: 0 } as WeeklyDrop;
    }
    
    // ========================================================================
    // STEP 2: BUILD USER TASTE FINGERPRINT
    // ========================================================================
    console.log(`[Curator V2] Step 2: Building user taste fingerprint...`);
    
    // Get user's saved tracks (strong signal)
    const { data: savedTracks } = await supabase
      .from('user_owned_tracks')
      .select('apple_music_id, track_name, artist_name, genres, energy, valence, danceability, acousticness, tempo')
      .eq('user_id', userId)
      .limit(100);
    
    // Get user's recently played (medium signal) - from taste vector or interactions
    const { data: recentInteractions } = await supabase
      .from('pairing_interactions')
      .select(`
        pair_tracks(apple_music_id, track_name, artist_name, genres, energy, valence, danceability, acousticness, tempo)
      `)
      .eq('user_id', userId)
      .in('interaction_type', ['played', 'liked', 'saved'])
      .order('created_at', { ascending: false })
      .limit(50);
    
    // Get disliked tracks
    const { data: dislikedTracks } = await supabase
      .from('user_disliked_tracks')
      .select('apple_music_id')
      .eq('user_id', userId);
    
    // Convert to PairTrack format
    const savedPairTracks: PairTrack[] = (savedTracks || []).map(t => ({
      apple_music_id: t.apple_music_id,
      track_name: t.track_name || '',
      artist_name: t.artist_name || '',
      genres: t.genres,
      energy: t.energy,
      valence: t.valence,
      danceability: t.danceability,
      acousticness: t.acousticness,
      tempo: t.tempo
    }));
    
    const recentPairTracks: PairTrack[] = (recentInteractions || [])
      .filter(i => i.pair_tracks)
      .map(i => {
        const t = i.pair_tracks as any;
        return {
          apple_music_id: t.apple_music_id,
          track_name: t.track_name || '',
          artist_name: t.artist_name || '',
          genres: t.genres,
          energy: t.energy,
          valence: t.valence,
          danceability: t.danceability,
          acousticness: t.acousticness,
          tempo: t.tempo
        };
      });
    
    const dislikedPairTracks: PairTrack[] = (dislikedTracks || []).map(t => ({
      apple_music_id: t.apple_music_id,
      track_name: '',
      artist_name: ''
    }));
    
    // Build fingerprint
    const fingerprint = buildTasteFingerprint(savedPairTracks, recentPairTracks, dislikedPairTracks);
    console.log(`[Curator V2] Fingerprint built: ${fingerprint.topArtists.length} top artists, ${Object.keys(fingerprint.genreWeights).length} genre weights`);
    
    // ========================================================================
    // STEP 3: EXCLUDE TRACKS
    // ========================================================================
    console.log(`[Curator V2] Step 3: Filtering exclusions...`);
    const exclusions = await getExclusionSets(userId);
    
    // Also exclude disliked artists
    const dislikedArtists = new Set(fingerprint.doNotServe.artists);
    
    const filteredCandidates = newReleases.filter(track => {
      // Exclude if already owned
      if (exclusions.has(track.apple_music_id)) return false;
      
      // Exclude if from disliked artist
      if (dislikedArtists.has(track.artist_name.toLowerCase())) return false;
      
      // Exclude if in do-not-serve list
      if (fingerprint.doNotServe.trackIds.includes(track.apple_music_id)) return false;
      
      return true;
    });
    
    console.log(`[Curator V2] ${filteredCandidates.length} candidates after exclusions`);
    
    // ========================================================================
    // STEP 4: SCORE CANDIDATES
    // ========================================================================
    console.log(`[Curator V2] Step 4: Scoring candidates against taste fingerprint...`);
    const threshold = await getConfidenceThreshold(userId);
    
    const scoredCandidates: Array<{ track: PairTrack; score: CandidateScore }> = [];
    
    for (const track of filteredCandidates) {
      const score = scoreNewReleaseCandidate(track, fingerprint);
      
      if (score.total >= threshold) {
        scoredCandidates.push({ track, score });
      }
    }
    
    // Sort by total score descending
    scoredCandidates.sort((a, b) => b.score.total - a.score.total);
    
    console.log(`[Curator V2] ${scoredCandidates.length} candidates passed threshold (${threshold})`);
    
    // ========================================================================
    // STEP 5: SELECT TOP 3-6 TRACKS
    // ========================================================================
    console.log(`[Curator V2] Step 5: Selecting top ${MIN_WEEKLY_TRACKS}-${MAX_WEEKLY_TRACKS} tracks...`);
    
    // Ensure artist diversity - max 2 tracks per artist
    const selectedTracks: Array<{ track: PairTrack; score: CandidateScore }> = [];
    const artistCounts: Record<string, number> = {};
    
    for (const candidate of scoredCandidates) {
      if (selectedTracks.length >= MAX_WEEKLY_TRACKS) break;
      
      const artist = candidate.track.artist_name.toLowerCase();
      const currentCount = artistCounts[artist] || 0;
      
      if (currentCount < 2) {
        selectedTracks.push(candidate);
        artistCounts[artist] = currentCount + 1;
      }
    }
    
    console.log(`[Curator V2] Selected ${selectedTracks.length} tracks for the week`);
    
    if (selectedTracks.length < MIN_WEEKLY_TRACKS) {
      console.log(`[Curator V2] Not enough high-conviction tracks - marking as empty`);
      await updateDropStatus(drop.id, 'empty');
      return { ...drop, status: 'empty', total_tracks: 0 } as WeeklyDrop;
    }
    
    // ========================================================================
    // STEP 6: ASSIGN TO BROAD GENRES FOR DISPLAY
    // ========================================================================
    console.log(`[Curator V2] Step 6: Assigning tracks to broad genres...`);
    
    let totalTracks = 0;
    
    for (let i = 0; i < selectedTracks.length; i++) {
      const { track, score } = selectedTracks[i];
      
      // Determine broad genre for this track
      const broadGenre = assignToBroadGenre(track);
      
      // Store track in pair_tracks if not exists
      let trackId: string;
      
      const { data: existingTrack } = await supabase
        .from('pair_tracks')
        .select('id')
        .eq('apple_music_id', track.apple_music_id)
        .single();
      
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
          console.error(`[Curator V2] Error inserting track:`, error);
          continue;
        }
        trackId = newTrack.id;
      }
      
      // Get or create genre record for this broad genre
      let genreId: string;
      const { data: existingGenre } = await supabase
        .from('curated_genres')
        .select('id')
        .eq('slug', broadGenre.slug)
        .single();
      
      if (existingGenre) {
        genreId = existingGenre.id;
      } else {
        // Create the broad genre
        const { data: newGenre, error: genreError } = await supabase
          .from('curated_genres')
          .insert({
            slug: broadGenre.slug,
            display_name: broadGenre.display_name,
            search_keywords: broadGenre.keywords,
            is_active: true,
            sort_order: BROAD_GENRES.findIndex(g => g.slug === broadGenre.slug)
          })
          .select('id')
          .single();
        
        if (genreError || !newGenre) {
          console.error(`[Curator V2] Error creating genre:`, genreError);
          continue;
        }
        genreId = newGenre.id;
      }
      
      // Insert into weekly_drop_tracks
      await supabase
        .from('weekly_drop_tracks')
        .insert({
          weekly_drop_id: drop.id,
          genre_id: genreId,
          track_id: trackId,
          position: i + 1,
          confidence: score.total,
          audio_sim: score.vibeMatch,
          text_sim: score.genreFit,
          scene_sim: score.artistProximity,
          reason: score.reason
        });
      
      totalTracks++;
      console.log(`[Curator V2] Added: "${track.track_name}" by ${track.artist_name} → ${broadGenre.display_name} (score: ${score.total.toFixed(2)})`);
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
    
    console.log(`[Curator V2] Weekly drop complete: ${totalTracks} tracks`);
    
    return {
      ...drop,
      status: finalStatus,
      total_tracks: totalTracks
    } as WeeklyDrop;
    
  } catch (error) {
    console.error(`[Curator V2] Error generating drop:`, error);
    await updateDropStatus(drop.id, 'failed');
    return null;
  }
}

/**
 * Assign a track to a broad genre based on its genre tags
 */
function assignToBroadGenre(track: PairTrack): BroadGenre {
  const trackGenres = (track.genres || []).map(g => g.toLowerCase());
  
  // Score each broad genre
  let bestMatch: BroadGenre = BROAD_GENRES[4]; // Default to Pop
  let bestScore = 0;
  
  for (const broadGenre of BROAD_GENRES) {
    let score = 0;
    
    for (const trackGenre of trackGenres) {
      for (const keyword of broadGenre.keywords) {
        if (trackGenre.includes(keyword) || keyword.includes(trackGenre)) {
          score += 1;
        }
      }
    }
    
    if (score > bestScore) {
      bestScore = score;
      bestMatch = broadGenre;
    }
  }
  
  return bestMatch;
}

async function updateDropStatus(dropId: string, status: string): Promise<void> {
  await supabase
    .from('weekly_drops')
    .update({ status })
    .eq('id', dropId);
}

/**
 * Get current week's Friday date (most recent Friday, or today if Friday)
 */
function getWeekFriday(): string {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = Sunday, 5 = Friday
  
  // Calculate days since last Friday
  // If today is Friday (5), use today
  let daysToSubtract = (dayOfWeek - 5 + 7) % 7;
  
  const friday = new Date(now);
  friday.setDate(now.getDate() - daysToSubtract);
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
