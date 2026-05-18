// Lightweight TF-IDF similarity for RAG-style note retrieval.
// No external dependencies — runs fully in-renderer.

const STOPWORDS = new Set([
  // English
  'the','and','for','are','but','not','you','all','can','had','her','was','one','our',
  'out','day','get','has','him','his','how','its','may','new','now','old','see','two',
  'use','way','who','boy','did','she','too','from','that','this','with','have','will',
  'your','they','them','then','than','when','been','were','said','each','what','which',
  'their','there','about','would','these','other','into','more','also','some','time',
  // Italian
  'per','che','con','del','nel','sul','dal','alla','delle','degli','nella','dello',
  'nei','sui','dai','agli','sulle','nelle','dai','agli','tra','fra','come','sono',
  'una','uno','non','una','gli','lei','lui','loro','anche','dopo','prima','tutto',
  'tutti','tutte','ogni','così','dove','quando','quale','quali','questo','questa',
  'questi','queste','quello','quella','quelli','quelle','molto','poco','mai','già',
  'ancora','sempre','solo','sia','essere','avere','fare','dire','andare','venire',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-zàáèéìíòóùú0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && !STOPWORDS.has(t));
}

function termFreq(tokens: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);
  return freq;
}

function buildIdf(notes: NoteChunk[]): Map<string, number> {
  const df = new Map<string, number>();
  const N = notes.length;
  for (const note of notes) {
    const seen = new Set(tokenize(note.text));
    for (const term of seen) df.set(term, (df.get(term) ?? 0) + 1);
  }
  const idf = new Map<string, number>();
  for (const [term, count] of df) {
    idf.set(term, Math.log((N + 1) / (count + 1)) + 1);
  }
  return idf;
}

function tfidfVector(tokens: string[], idf: Map<string, number>): Map<string, number> {
  const tf = termFreq(tokens);
  const vec = new Map<string, number>();
  for (const [term, freq] of tf) {
    vec.set(term, freq * (idf.get(term) ?? 1));
  }
  return vec;
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

  const idf = buildIdf(notes);
  const qVec = tfidfVector(qTokens, idf);

  const scored = notes.map(note => {
    const nVec = tfidfVector(tokenize(note.text), idf);
    return { note, score: cosineSimilarity(qVec, nVec) };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .filter(s => s.score > 0)
    .map(s => s.note);
}
