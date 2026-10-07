// A health check of a whole vault: what is broken, what is lost, what is repeated, what has gone stale. Every check is
// deterministic (no model): the same vault gives the same report, and each finding says exactly what it saw. Pure: the notes
// as the indexes know them go in, a report comes out; reading the vault and fixing what is found are done elsewhere.

import { buildLinkResolver, type AliasMap } from '../vault/resolve';
import { findHeadingIndex } from '../vault/wikilink';
import { tokenize } from '../search/invertedIndex';

/** A note as the check sees it. */
export interface LintNote {
  /** Vault-relative path, with ".md". */
  name: string;
  /** Links as written: the target (a name or a path, no ".md"), and the heading it names, if any. */
  links: { target: string; heading?: string }[];
  headings: string[];
  aliases: string[];
  /** The frontmatter, as typed values (only emptiness is looked at). */
  fields: Record<string, unknown>;
  /** The note as plain text, without frontmatter or markup. */
  text: string;
  mtimeMs: number;
  /** False when the note was too large to read: nothing is said about what it holds. */
  parsed: boolean;
}

export interface LintOptions {
  /** A note not touched for this many days is stale. */
  staleDays: number;
  /** Today, in ms (given, so that a report is a function of its input). */
  now: number;
  /** Notes at or above this many words should have a summary. */
  summaryMinWords: number;
  /** Two notes at least this alike (0..1: the share of runs of four words that they have in common) are near duplicates. A single changed word in a long note costs little; in a short one, more. */
  nearDuplicate: number;
}

export const DEFAULT_LINT: Omit<LintOptions, 'now'> = { staleDays: 365, summaryMinWords: 200, nearDuplicate: 0.8 };

/** Properties that count as a note's summary. */
export const SUMMARY_FIELDS = ['summary', 'description', 'abstract', 'tldr'] as const;

export type FindingKind = 'broken-link' | 'broken-heading' | 'isolated' | 'duplicate' | 'near-duplicate' | 'same-name' | 'stale' | 'empty' | 'no-summary';

export type Finding =
  | { id: string; kind: 'broken-link'; note: string; target: string; /** An existing note this was probably meant to be. */ suggestion: string | null }
  | { id: string; kind: 'broken-heading'; note: string; target: string; resolved: string; heading: string }
  | { id: string; kind: 'isolated'; note: string }
  | { id: string; kind: 'duplicate'; /** Notes with the same text, the first being the oldest. */ notes: string[] }
  | { id: string; kind: 'near-duplicate'; notes: [string, string]; similarity: number }
  | { id: string; kind: 'same-name'; /** The name they share (without folder and extension) and the notes that have it. */ name: string; notes: string[] }
  | { id: string; kind: 'stale'; note: string; days: number }
  | { id: string; kind: 'empty'; note: string }
  | { id: string; kind: 'no-summary'; note: string; words: number };

export interface LintReport {
  generatedAt: number;
  notes: number;
  options: Omit<LintOptions, 'now'>;
  findings: Finding[];
  counts: Record<FindingKind, number>;
  /** Notes too large to be read: whatever they contain is not in this report. */
  unread: string[];
}

const DAY = 86_400_000;
const FNV = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};
const baseOf = (name: string): string => name.replace(/\.md$/i, '').split('/').pop() ?? '';
const stripMarks = (s: string): string => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const DAILY = /^\d{4}-\d{2}-\d{2}/;
/** Notes parked on purpose: in a folder named Archive, which is where the fix for a stale note puts them. */
export const isArchived = (name: string): boolean => /^archive\//i.test(name);
/** Daily notes stand alone by design, and so do archived ones. */
const isIsolationExempt = (name: string): boolean => DAILY.test(baseOf(name)) || isArchived(name);
/**
 * What this check writes (`reports/…`) is not part of what it checks: its links would connect the notes it lists, its mentions of
 * missing notes would be broken links, and it would be stale, a duplicate of the last one, and long without a summary.
 */
export const isReportNote = (name: string): boolean => /^reports\//i.test(name);

/** Finds, for a missing target, the existing note it was most likely meant to be: the same name apart from case and accents, else one or two typos away. Names are prepared once and answers remembered. */
function closestFinder(names: readonly string[]): (target: string) => string | null {
  const prepared = names.map(name => ({ name, base: stripMarks(baseOf(name)) }));
  const answers = new Map<string, string | null>();
  return (target) => {
    const want = stripMarks(baseOf(target));
    if (!want) return null;
    if (answers.has(want)) return answers.get(want) ?? null;
    const tolerance = want.length <= 4 ? 0 : want.length <= 8 ? 1 : 2;
    let best: { name: string; d: number } | null = null;
    let tie = false;
    for (const { name, base } of prepared) {
      if (Math.abs(base.length - want.length) > tolerance) continue;
      const d = editDistance(want, base, tolerance);
      if (d > tolerance) continue;
      if (!best || d < best.d) { best = { name, d }; tie = false; } else if (d === best.d) tie = true;
    }
    const answer = best && !tie ? best.name : null;
    answers.set(want, answer);
    return answer;
  };
}

/** The existing note a missing target was most likely meant to be: the same name apart from case and accents, else one or two typos away; null when there is none or two are equally close. */
export function closestName(target: string, names: readonly string[]): string | null {
  return closestFinder(names)(target);
}

/** Levenshtein distance, giving up (returning more than `max`) as soon as it must exceed it. */
function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

const emptyField = (v: unknown): boolean => v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);

/** The text as words, for comparing notes: letters and digits, any case. */
const wordsOf = (text: string): string[] => tokenize(text, { minLength: 1 });

const SHINGLE = 4;
/** A shingle that is in more notes than this is boilerplate (a template's header) and says nothing about two notes being alike. */
const COMMON_SHINGLE = 40;

/** The distinct runs of four words in a note, as numbers: each word is hashed once, a run is those hashes combined (no strings built). */
function shingles(words: readonly string[]): Uint32Array {
  const hashes = words.map(FNV);
  const set = new Set<number>();
  for (let i = 0; i + SHINGLE <= hashes.length; i++) {
    let h = 0;
    for (let j = 0; j < SHINGLE; j++) h = (Math.imul(h, 0x01000193) ^ hashes[i + j]) >>> 0;
    set.add(h);
  }
  return Uint32Array.from(set);
}

export function lintVault(input: readonly LintNote[], opts: LintOptions): LintReport {
  const options = { staleDays: opts.staleDays, summaryMinWords: opts.summaryMinWords, nearDuplicate: opts.nearDuplicate };
  const notes = [...input].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const names = notes.map(n => n.name);
  const aliases: Record<string, string[]> = {};
  for (const n of notes) if (n.aliases.length > 0) aliases[n.name] = n.aliases;
  const resolver = buildLinkResolver(names, aliases as AliasMap);
  const closest = closestFinder(names);
  const byName = new Map(notes.map(n => [n.name, n]));
  const findings: Finding[] = [];
  const read = notes.filter(n => n.parsed && !isReportNote(n.name));

  // Links: to nothing, or to a heading that is not there. Who links to whom is kept for the isolated notes.
  const inbound = new Map<string, Set<string>>();
  const outbound = new Map<string, number>();
  for (const note of read) {
    const reported = new Set<string>();
    for (const link of note.links) {
      const target = resolver.resolve(link.target, note.name);
      if (target === null) {
        const key = link.target.trim().toLowerCase();
        if (reported.has(key)) continue;
        reported.add(key);
        findings.push({ id: `broken-link:${note.name}:${key}`, kind: 'broken-link', note: note.name, target: link.target, suggestion: closest(link.target) });
        continue;
      }
      if (target !== note.name) {
        (inbound.get(target) ?? inbound.set(target, new Set()).get(target)!).add(note.name);
        outbound.set(note.name, (outbound.get(note.name) ?? 0) + 1);
      }
      const dest = byName.get(target);
      if (link.heading && dest?.parsed && findHeadingIndex(dest.headings.map(text => ({ text })), link.heading) === -1) {
        const key = `${target}#${link.heading}`.toLowerCase();
        if (reported.has(key)) continue;
        reported.add(key);
        findings.push({ id: `broken-heading:${note.name}:${key}`, kind: 'broken-heading', note: note.name, target: link.target, resolved: target, heading: link.heading });
      }
    }
  }

  // Notes nothing links to and that link to nothing.
  for (const note of read) {
    if (isIsolationExempt(note.name)) continue;
    if (!inbound.has(note.name) && !outbound.has(note.name)) findings.push({ id: `isolated:${note.name}`, kind: 'isolated', note: note.name });
  }

  // Notes that say the same thing: exactly, and nearly.
  const wordLists = new Map<string, string[]>();
  for (const note of read) wordLists.set(note.name, wordsOf(note.text));
  const byText = new Map<string, string[]>();
  for (const note of read) {
    const words = wordLists.get(note.name) as string[];
    if (words.length < 8) continue; // a few words are the same in many notes
    const key = String(FNV(words.join(' '))) + ':' + words.length;
    (byText.get(key) ?? byText.set(key, []).get(key)!).push(note.name);
  }
  // Of a group of exact copies only the oldest takes part in the near-duplicate comparison: the others would only repeat its results.
  const copies = new Set<string>();
  for (const group of byText.values()) {
    if (group.length < 2) continue;
    const ordered = [...group].sort((a, b) => (byName.get(a)!.mtimeMs - byName.get(b)!.mtimeMs) || (a < b ? -1 : 1));
    for (const n of ordered.slice(1)) copies.add(n);
    findings.push({ id: `duplicate:${ordered.join('|')}`, kind: 'duplicate', notes: ordered });
  }
  const candidates = read.filter(n => (wordLists.get(n.name) as string[]).length >= 20 && !copies.has(n.name));
  const sets = candidates.map(n => shingles(wordLists.get(n.name) as string[]));
  const holders = new Map<number, number[]>();
  sets.forEach((set, i) => { for (const h of set) (holders.get(h) ?? holders.set(h, []).get(h)!).push(i); });
  const shared = new Map<number, number>();
  for (const list of holders.values()) {
    if (list.length < 2 || list.length > COMMON_SHINGLE) continue;
    for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
      const key = list[a] * candidates.length + list[b];
      shared.set(key, (shared.get(key) ?? 0) + 1);
    }
  }
  const near: Finding[] = [];
  for (const [key, count] of shared) {
    const i = Math.floor(key / candidates.length);
    const j = key % candidates.length;
    const similarity = count / (sets[i].length + sets[j].length - count);
    if (similarity < opts.nearDuplicate) continue;
    const pair = [candidates[i].name, candidates[j].name].sort() as [string, string];
    near.push({ id: `near-duplicate:${pair.join('|')}`, kind: 'near-duplicate', notes: pair, similarity: Math.round(similarity * 100) / 100 });
  }
  near.sort((a, b) => (b as { similarity: number }).similarity - (a as { similarity: number }).similarity || (a.id < b.id ? -1 : 1));
  findings.push(...near);

  // Two notes of the same name in different folders: a link to the bare name can mean either.
  const byBase = new Map<string, string[]>();
  for (const name of names.filter(n => !isReportNote(n))) (byBase.get(stripMarks(baseOf(name))) ?? byBase.set(stripMarks(baseOf(name)), []).get(stripMarks(baseOf(name)))!).push(name);
  for (const [base, group] of byBase) {
    if (group.length < 2 || !base) continue;
    findings.push({ id: `same-name:${base}`, kind: 'same-name', name: baseOf(group[0]), notes: group });
  }

  for (const note of read) {
    const words = (wordLists.get(note.name) as string[]).length;
    if (words === 0) { findings.push({ id: `empty:${note.name}`, kind: 'empty', note: note.name }); continue; }
    const days = Math.floor((opts.now - note.mtimeMs) / DAY);
    if (days >= opts.staleDays && !isArchived(note.name)) findings.push({ id: `stale:${note.name}`, kind: 'stale', note: note.name, days });
    if (words >= opts.summaryMinWords && !isArchived(note.name) && SUMMARY_FIELDS.every(f => emptyField(note.fields[f]))) findings.push({ id: `no-summary:${note.name}`, kind: 'no-summary', note: note.name, words });
  }

  const counts = Object.fromEntries((['broken-link', 'broken-heading', 'isolated', 'duplicate', 'near-duplicate', 'same-name', 'stale', 'empty', 'no-summary'] as FindingKind[]).map(k => [k, 0])) as Record<FindingKind, number>;
  for (const f of findings) counts[f.kind]++;
  return { generatedAt: opts.now, notes: notes.length, options, findings, counts, unread: notes.filter(n => !n.parsed && !isReportNote(n.name)).map(n => n.name) };
}
