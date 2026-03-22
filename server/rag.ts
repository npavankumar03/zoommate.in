import { storage } from "./storage";
import { getPrewarmedOpenAIKey } from "./llmRouter";

const EMBEDDING_MODEL = "text-embedding-3-small";
const MAX_CHUNK_CHARS = 1100;
const CHUNK_OVERLAP_CHARS = 180;
const MAX_RETRIEVED_CHUNKS = 6;

function normalizeText(value: string): string {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\t/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function chunkDocumentText(content: string): string[] {
  const text = normalizeText(content);
  if (!text) return [];

  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= MAX_CHUNK_CHARS) {
      current = candidate;
      continue;
    }

    if (current) {
      chunks.push(current);
      const overlap = current.slice(Math.max(0, current.length - CHUNK_OVERLAP_CHARS)).trim();
      current = overlap ? `${overlap}\n\n${paragraph}` : paragraph;
      if (current.length <= MAX_CHUNK_CHARS) continue;
    }

    let remaining = paragraph;
    while (remaining.length > MAX_CHUNK_CHARS) {
      chunks.push(remaining.slice(0, MAX_CHUNK_CHARS).trim());
      remaining = remaining.slice(MAX_CHUNK_CHARS - CHUNK_OVERLAP_CHARS).trim();
    }
    current = remaining;
  }

  if (current) chunks.push(current.trim());
  return chunks.filter(Boolean);
}

async function createEmbedding(input: string): Promise<number[]> {
  const apiKey = getPrewarmedOpenAIKey() || process.env.OPENAI_API_KEY;
  if (!apiKey) return [];

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Embedding API error (${response.status}): ${errText.slice(0, 200)}`);
  }

  const json = await response.json() as any;
  return Array.isArray(json?.data?.[0]?.embedding) ? json.data[0].embedding as number[] : [];
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (!magA || !magB) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function lexicalScore(query: string, chunk: string): number {
  const qTokens = normalizeText(query).toLowerCase().split(/\s+/).filter((t) => t.length >= 3);
  if (!qTokens.length) return 0;
  const lowerChunk = normalizeText(chunk).toLowerCase();
  let score = 0;
  for (const token of qTokens) {
    if (lowerChunk.includes(token)) score += 1;
  }
  return score / qTokens.length;
}

export async function indexDocumentForRag(documentId: string): Promise<void> {
  const document = await storage.getDocument(documentId);
  if (!document) return;

  const chunks = chunkDocumentText(document.content);
  if (!chunks.length) {
    await storage.deleteDocumentChunksByDocument(documentId);
    return;
  }

  const indexed: Array<{ chunkIndex: number; content: string; embedding: number[] }> = [];
  for (let i = 0; i < chunks.length; i++) {
    const embedding = await createEmbedding(chunks[i]).catch(() => []);
    indexed.push({
      chunkIndex: i,
      content: chunks[i],
      embedding,
    });
  }

  await storage.replaceDocumentChunks(documentId, document.userId, indexed);
}

export async function retrieveDocumentContext(
  userId: string,
  question: string,
  documentIds: string[],
  limit = MAX_RETRIEVED_CHUNKS,
): Promise<string> {
  if (!question.trim()) return "";

  // Auto-include past_answers documents — these are session Q&A indexed for
  // consistency grounding. They don't need to be in the user's document list.
  const uniqueDocumentIds = [...new Set(documentIds.filter(Boolean))];
  if (!uniqueDocumentIds.length) return "";

  const allDocs = await storage.getDocuments(userId);

  const [chunks, documents] = await Promise.all([
    storage.getDocumentChunks(userId, uniqueDocumentIds),
    Promise.resolve(allDocs),
  ]);

  if (!chunks.length) return "";

  const docsById = new Map(documents.map((doc) => [doc.id, doc]));
  const queryEmbedding = await createEmbedding(question).catch(() => []);
  const scored = queryEmbedding.length
    ? await storage.searchDocumentChunks(userId, queryEmbedding, uniqueDocumentIds, Math.max(1, limit))
    : chunks
      .map((chunk) => {
        const embedding = Array.isArray(chunk.embedding) ? chunk.embedding : [];
        const vectorScore = queryEmbedding.length && embedding.length ? cosineSimilarity(queryEmbedding, embedding) : 0;
        const score = vectorScore > 0 ? vectorScore : lexicalScore(question, chunk.content);
        return { chunk, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, limit));

  if (!scored.length) return "";

  return scored
    .map(({ chunk }) => {
      const doc = docsById.get(chunk.documentId);
      const label = doc ? `${doc.name} (${doc.type})` : chunk.documentId;
      return `[${label} chunk ${chunk.chunkIndex + 1}]\n${chunk.content}`;
    })
    .join("\n\n");
}
