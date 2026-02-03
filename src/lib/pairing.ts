import { AudioFeatures, SpotifyTrack } from "./spotify";
import { getVibeSimilarity } from "./embeddings";

export type PairingMode = "same_sound" | "same_vibe" | "same_scene" | "adventure";

interface NormalizedFeatures {
  danceability: number;
  energy: number;
  valence: number;
  tempo: number;
  acousticness: number;
  instrumentalness: number;
  loudness: number;
}

const FEATURE_WEIGHTS = {
  energy: 1.2,
  danceability: 1.1,
  tempo: 1.0,
  valence: 0.9,
  acousticness: 0.8,
  instrumentalness: 0.8,
  loudness: 0.7,
};

const MODE_WEIGHTS: Record<PairingMode, { sound: number; vibe: number; novelty: number; scene: number }> = {
  same_sound: { sound: 0.70, vibe: 0.15, novelty: 0.15, scene: 0 },
  same_vibe: { sound: 0.45, vibe: 0.40, novelty: 0.15, scene: 0 },
  same_scene: { sound: 0.35, vibe: 0.25, novelty: 0, scene: 0.40 },
  adventure: { sound: 0.35, vibe: 0.35, novelty: 0.30, scene: 0 },
};

export function normalizeFeatures(features: AudioFeatures): NormalizedFeatures {
  const tempoNorm = Math.max(0, Math.min(1, (features.tempo - 60) / 120));
  const loudnessNorm = Math.max(0, Math.min(1, (features.loudness + 30) / 30));

  return {
    danceability: features.danceability,
    energy: features.energy,
    valence: features.valence,
    tempo: tempoNorm,
    acousticness: features.acousticness,
    instrumentalness: features.instrumentalness,
    loudness: loudnessNorm,
  };
}

export function computeSoundSimilarity(
  seedFeatures: NormalizedFeatures,
  candidateFeatures: NormalizedFeatures
): number {
  const features: (keyof NormalizedFeatures)[] = [
    "danceability",
    "energy",
    "valence",
    "tempo",
    "acousticness",
    "instrumentalness",
    "loudness",
  ];

  let dotProduct = 0;
  let normSeed = 0;
  let normCandidate = 0;

  for (const feature of features) {
    const weight = FEATURE_WEIGHTS[feature];
    const seedVal = seedFeatures[feature] * weight;
    const candidateVal = candidateFeatures[feature] * weight;

    dotProduct += seedVal * candidateVal;
    normSeed += seedVal * seedVal;
    normCandidate += candidateVal * candidateVal;
  }

  if (normSeed === 0 || normCandidate === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(normSeed) * Math.sqrt(normCandidate));
}

export function computeNoveltyScore(soundSimilarity: number, mode: PairingMode): number {
  if (mode === "adventure") {
    if (soundSimilarity >= 0.55 && soundSimilarity <= 0.80) {
      return 1.0;
    } else if (soundSimilarity < 0.55) {
      return 0.3;
    } else {
      return 0.6;
    }
  }
  return Math.max(0, Math.min(1, 1 - soundSimilarity));
}

export interface ScoredCandidate {
  track: SpotifyTrack;
  features: AudioFeatures;
  normalizedFeatures: NormalizedFeatures;
  soundSimilarity: number;
  vibeSimilarity: number;
  noveltyScore: number;
  sceneScore: number;
  finalScore: number;
  explanation: string;
}

export async function scoreCandidate(
  seedTrack: SpotifyTrack,
  seedFeatures: NormalizedFeatures,
  candidate: SpotifyTrack,
  candidateFeatures: AudioFeatures,
  prompt: string,
  mode: PairingMode,
  relatedArtistIds: Set<string>,
  genres: string[]
): Promise<ScoredCandidate> {
  const normalizedCandidate = normalizeFeatures(candidateFeatures);
  const soundSimilarity = computeSoundSimilarity(seedFeatures, normalizedCandidate);

  const candidateText = `${candidate.track_name} ${candidate.artist_name} ${genres.join(" ")}`;
  const vibeSimilarity = await getVibeSimilarity(prompt, candidateText);

  const noveltyScore = computeNoveltyScore(soundSimilarity, mode);

  const sceneScore = relatedArtistIds.has(candidate.artist_id) ? 1.0 : 0.3;

  const weights = MODE_WEIGHTS[mode];
  const finalScore =
    weights.sound * soundSimilarity +
    weights.vibe * vibeSimilarity +
    weights.novelty * noveltyScore +
    weights.scene * sceneScore;

  const explanation = generateExplanation(
    seedFeatures,
    normalizedCandidate,
    prompt,
    soundSimilarity,
    vibeSimilarity
  );

  return {
    track: candidate,
    features: candidateFeatures,
    normalizedFeatures: normalizedCandidate,
    soundSimilarity,
    vibeSimilarity,
    noveltyScore,
    sceneScore,
    finalScore,
    explanation,
  };
}

function generateExplanation(
  seedFeatures: NormalizedFeatures,
  candidateFeatures: NormalizedFeatures,
  prompt: string,
  soundSimilarity: number,
  vibeSimilarity: number
): string {
  const featureDescriptors: Record<keyof NormalizedFeatures, { name: string; emotional: string[] }> = {
    danceability: { 
      name: "groove", 
      emotional: ["infectious rhythm", "body-moving beat", "danceable pulse"] 
    },
    energy: { 
      name: "energy", 
      emotional: ["driving intensity", "raw power", "electric feel"] 
    },
    valence: { 
      name: "mood", 
      emotional: ["emotional tone", "introspective feel", "uplifting spirit"] 
    },
    tempo: { 
      name: "tempo", 
      emotional: ["smooth pace", "steady flow", "matching rhythm"] 
    },
    acousticness: { 
      name: "acoustic warmth", 
      emotional: ["organic texture", "warm tones", "intimate sound"] 
    },
    instrumentalness: { 
      name: "instrumental depth", 
      emotional: ["layered soundscape", "rich instrumentation", "sonic depth"] 
    },
    loudness: { 
      name: "intensity", 
      emotional: ["bold presence", "dynamic range", "powerful delivery"] 
    },
  };

  const emotionalPhrases = [
    "perfect for the moment",
    "hits the same way",
    "carries that feeling",
    "captures the essence",
    "fits right in",
  ];

  const features: (keyof NormalizedFeatures)[] = [
    "danceability", "energy", "valence", "tempo", 
    "acousticness", "instrumentalness", "loudness",
  ];

  const similarities: { feature: keyof NormalizedFeatures; diff: number }[] = features.map((f) => ({
    feature: f,
    diff: Math.abs(seedFeatures[f] - candidateFeatures[f]),
  }));

  similarities.sort((a, b) => a.diff - b.diff);
  const topFeature = similarities[0].feature;
  
  const descriptor = featureDescriptors[topFeature];
  const emotionalChoice = descriptor.emotional[Math.floor(Math.random() * descriptor.emotional.length)];
  
  const templates = [
    `${emotionalChoice} with matching ${descriptor.name}`,
    `Shares that ${emotionalChoice}`,
    `${descriptor.name.charAt(0).toUpperCase() + descriptor.name.slice(1)} and ${emotionalChoice}`,
  ];
  
  let explanation = templates[Math.floor(Math.random() * templates.length)];

  if (prompt && prompt.trim() !== "" && vibeSimilarity > 0.5) {
    const promptPhrases = [
      `— ${emotionalPhrases[Math.floor(Math.random() * emotionalPhrases.length)]}`,
      ` that ${emotionalPhrases[Math.floor(Math.random() * emotionalPhrases.length)]}`,
    ];
    explanation += promptPhrases[Math.floor(Math.random() * promptPhrases.length)];
  }

  return explanation;
}

export function applyDiversityRule(candidates: ScoredCandidate[], maxPerArtist: number = 2): ScoredCandidate[] {
  const artistCounts: Map<string, number> = new Map();
  const result: ScoredCandidate[] = [];

  for (const candidate of candidates) {
    const artistId = candidate.track.artist_id;
    const count = artistCounts.get(artistId) || 0;

    if (count < maxPerArtist) {
      result.push(candidate);
      artistCounts.set(artistId, count + 1);
    }
  }

  return result;
}

export function rankCandidates(candidates: ScoredCandidate[], topN: number = 20): ScoredCandidate[] {
  const sorted = [...candidates].sort((a, b) => b.finalScore - a.finalScore);
  const diversified = applyDiversityRule(sorted);
  return diversified.slice(0, topN);
}
