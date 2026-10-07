// Word error rate: how many words of a transcript are wrong against what was said (substitutions, deletions and insertions, over the
// number of words said). Case, punctuation and accents-as-written are not held against a transcript.

export function words(text) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').replace(/'/g, ' ').split(/\s+/).filter(Boolean);
}

export function wer(reference, hypothesis) {
  const r = words(reference);
  const h = words(hypothesis);
  if (r.length === 0) return h.length === 0 ? 0 : 1;
  let prev = Array.from({ length: h.length + 1 }, (_, i) => i);
  for (let i = 1; i <= r.length; i++) {
    const cur = [i];
    for (let j = 1; j <= h.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[h.length] / r.length;
}
