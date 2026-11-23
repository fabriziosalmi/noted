export interface SelectionStats {
  words: number;
  chars: number;
  charsNoSpaces: number;
  tokensEstimate: number;
}

export function computeTextStats(text: string): SelectionStats {
  const words = text.split(/\s+/).filter(Boolean).length;
  const tokensEstimate = text.trim() === '' ? 0 : Math.max(1, Math.ceil(text.length / 4));
  return {
    words,
    chars: text.length,
    charsNoSpaces: text.replace(/\s+/g, '').length,
    tokensEstimate,
  };
}

export function formatStatsLabel(stats: SelectionStats): string {
  if (stats.chars === 0) return '';
  return `${stats.words}w · ${stats.chars}c · ~${stats.tokensEstimate}t`;
}
