import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

let embeddingCache: Map<string, number[]> = new Map();

export async function getEmbedding(text: string): Promise<number[]> {
  const cached = embeddingCache.get(text);
  if (cached) {
    return cached;
  }

  try {
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
    });

    const embedding = response.data[0].embedding;
    embeddingCache.set(text, embedding);
    return embedding;
  } catch (error) {
    console.error("Failed to get embedding:", error);
    return [];
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function getVibeSimilarity(
  prompt: string,
  candidateText: string
): Promise<number> {
  if (!prompt || prompt.trim() === "") {
    return 0.5;
  }

  const [promptEmbedding, candidateEmbedding] = await Promise.all([
    getEmbedding(prompt),
    getEmbedding(candidateText),
  ]);

  if (promptEmbedding.length === 0 || candidateEmbedding.length === 0) {
    return 0.5;
  }

  const similarity = cosineSimilarity(promptEmbedding, candidateEmbedding);
  return (similarity + 1) / 2;
}
