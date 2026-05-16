// Lightweight TF-IDF similarity for RAG-style note retrieval.
// No external dependencies — runs fully in-renderer.

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-zàáèéìíòóùú0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2);
}

function termFreq(tokens: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);
  return freq;
}

function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0, normA = 0, normB = 0;
  for (const [term, fa] of a) {
    dot += fa * (b.get(term) ?? 0);
    normA += fa * fa;
  }
  for (const fb of b.values()) normB += fb * fb;
  return normA === 0 || normB === 0 ? 0 : dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface NoteChunk {
  name: string;
  text: string;
}

export function findRelevantNotes(query: string, notes: NoteChunk[], topK = 3): NoteChunk[] {
  if (notes.length === 0) return [];
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return notes.slice(0, topK);
  const qFreq = termFreq(qTokens);

  const scored = notes.map(note => {
    const nFreq = termFreq(tokenize(note.text));
    return { note, score: cosineSimilarity(qFreq, nFreq) };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .filter(s => s.score > 0)
    .map(s => s.note);
}
