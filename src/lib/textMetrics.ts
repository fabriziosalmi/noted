const STOPWORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with','by','from','as','is','are','was','were','be','been','being','have','has','had','do','does','did','will','would','could','should','may','might','shall','that','this','these','those','i','you','he','she','it','we','they','me','him','her','us','them','my','your','his','its','our','their',
  'il','lo','la','le','i','gli','un','una','e','o','ma','in','su','con','per','di','da','che','non','si','è','sono','era','ha','ho','ci','mi','ti','vi','li','ne','se','come','cosa','chi','più',
  'el','la','los','las','un','una','y','o','pero','en','con','por','de','del','que','no','se','es','son','era','al','su','sus','una','unos',
  'o','a','os','as','um','uma','e','ou','mas','em','com','por','de','da','do','que','não','se','é','são','era',
  'le','la','les','un','une','des','et','ou','mais','en','avec','pour','de','du','que','ne','se','est','sont','était','au','aux',
  'der','die','das','ein','eine','und','oder','aber','in','mit','für','von','zu','dass','nicht','sich','ist','sind','war','haben','werden','auch','eine','einer',
]);

function syllableCount(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length <= 3) return 1;
  const vowels = w.match(/[aeiouy]+/g);
  let count = vowels ? vowels.length : 1;
  if (w.endsWith('e')) count--;
  if (w.endsWith('le') && w.length > 2) count++;
  return Math.max(1, count);
}

export interface TextMetrics {
  words: number;
  chars: number;
  sentences: number;
  paragraphs: number;
  readingTimeMin: number;
  fleschScore: number;
  fleschLabel: string;
  avgWordsPerSentence: number;
  topKeywords: Array<{ word: string; count: number }>;
  tone: 'formal' | 'neutral' | 'informal';
}

function fleschLabel(score: number): string {
  if (score >= 90) return 'Very Easy';
  if (score >= 80) return 'Easy';
  if (score >= 70) return 'Fairly Easy';
  if (score >= 60) return 'Standard';
  if (score >= 50) return 'Fairly Difficult';
  if (score >= 30) return 'Difficult';
  return 'Very Difficult';
}

export function computeMetrics(plainText: string): TextMetrics {
  const text = plainText.trim();
  if (!text) {
    return { words: 0, chars: 0, sentences: 0, paragraphs: 0, readingTimeMin: 0, fleschScore: 0, fleschLabel: '—', avgWordsPerSentence: 0, topKeywords: [], tone: 'neutral' };
  }

  const chars = text.length;
  const wordTokens = text.match(/\b\w+\b/g) ?? [];
  const words = wordTokens.length;
  const sentenceMatches = text.match(/[^.!?]+[.!?]+/g) ?? [];
  const sentences = Math.max(1, sentenceMatches.length);
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim()).length || 1;
  const readingTimeMin = Math.max(1, Math.ceil(words / 200));

  // Flesch Reading Ease
  const totalSyllables = wordTokens.reduce((sum, w) => sum + syllableCount(w), 0);
  const avgSentenceLen = words / sentences;
  const avgSyllablesPerWord = totalSyllables / Math.max(1, words);
  const fleschScore = Math.round(206.835 - 1.015 * avgSentenceLen - 84.6 * avgSyllablesPerWord);
  const clampedFlesch = Math.max(0, Math.min(100, fleschScore));

  // Top keywords (TF, excluding stopwords, min 3 chars)
  const freq: Record<string, number> = {};
  for (const w of wordTokens) {
    const lower = w.toLowerCase();
    if (lower.length >= 3 && !STOPWORDS.has(lower)) {
      freq[lower] = (freq[lower] ?? 0) + 1;
    }
  }
  const topKeywords = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word, count]) => ({ word, count }));

  // Tone heuristic
  const avgWordLen = chars / Math.max(1, words);
  let tone: 'formal' | 'neutral' | 'informal' = 'neutral';
  if (avgWordLen > 5.5 && avgSentenceLen > 18) tone = 'formal';
  else if (avgWordLen < 4 && avgSentenceLen < 12) tone = 'informal';

  return {
    words,
    chars,
    sentences,
    paragraphs,
    readingTimeMin,
    fleschScore: clampedFlesch,
    fleschLabel: fleschLabel(clampedFlesch),
    avgWordsPerSentence: Math.round(avgSentenceLen * 10) / 10,
    topKeywords,
    tone,
  };
}
