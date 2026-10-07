// A source note: what a web page or a text says, in a few lines, with where it came from and which of your notes it is near. This is the
// pure part (what to ask, how to read the answer, how the note is laid out); fetching, the model and the review are elsewhere.

import type { DiffRow } from '../diff/textDiff';
import type { Change, Piece, Reviewable } from '../diff/hunks';

/** How much of a source the model is shown; a longer one is cut at a paragraph, and the note says so. */
export const MODEL_CHARS = 12_000;

export interface SourceSummary {
  title: string | null;
  summary: string;
  keyPoints: string[];
}

export const SUMMARY_SYSTEM = [
  'You read a source and write notes about it for someone who keeps a personal knowledge base.',
  'Reply with JSON only, no other text: {"title": "a short title", "summary": "two to four sentences", "key_points": ["three to seven short points"]}.',
  "Write in the same language as the source. Say only what the source says: add no facts, no opinions, no advice.",
].join('\n');

/** The source as the model is given it: cut at the end of a paragraph if it is long. */
export function clipForModel(text: string, max = MODEL_CHARS): { text: string; clipped: boolean } {
  if (text.length <= max) return { text, clipped: false };
  const cut = text.slice(0, max);
  const para = cut.lastIndexOf('\n\n');
  return { text: para > max * 0.6 ? cut.slice(0, para) : cut, clipped: true };
}

const MAX_SUMMARY = 1200;
const MAX_POINTS = 8;
const MAX_POINT = 240;

const cap = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const text = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

/** The model's answer as a summary. A model that did not keep to JSON is not a failure: its words are the summary. */
export function parseSummary(answer: string): SourceSummary {
  const trimmed = answer.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)?.[1];
  const braces = /\{[\s\S]*\}/.exec(fenced ?? trimmed)?.[0];
  for (const candidate of [fenced?.trim(), braces, trimmed]) {
    if (!candidate) continue;
    try {
      const v = JSON.parse(candidate) as Record<string, unknown>;
      if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
      const points = [v.key_points, v.keyPoints, v.points].find(Array.isArray) as unknown[] | undefined;
      const summary = text(v.summary);
      if (!summary && !points) continue;
      return {
        title: text(v.title) || null,
        summary: cap(summary, MAX_SUMMARY),
        keyPoints: (points ?? []).map(text).filter(Boolean).slice(0, MAX_POINTS).map(p => cap(p, MAX_POINT)),
      };
    } catch { /* not JSON: try the next reading */ }
  }
  return { title: null, summary: cap(trimmed.replace(/\s+/g, ' '), MAX_SUMMARY), keyPoints: [] };
}

export interface RelatedNote { note: string; reason: string }

/** The notes the source is near: the distinct notes of the best sections, in the order they came, not the notes in `skip`. */
export function relatedNotes(chunks: readonly { name: string; title: string; headingPath: string[] }[], skip: ReadonlySet<string>, max = 5): RelatedNote[] {
  const out: RelatedNote[] = [];
  for (const c of chunks) {
    if (skip.has(c.name) || out.some(r => r.note === c.name)) continue;
    out.push({ note: c.name, reason: c.headingPath.length > 0 ? c.headingPath.join(' › ') : '' });
    if (out.length >= max) break;
  }
  return out;
}

/** The name of a note for a title: no character a path cannot hold, no more than 80, one that is not taken (compared without case). */
export function sourceNoteName(title: string, taken: ReadonlySet<string>, folder = 'sources'): string {
  // eslint-disable-next-line no-control-regex
  const stem = title.replace(/[\\/:*?"<>|;`$\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').replace(/^[. ]+|[. ]+$/g, '').slice(0, 80).trim() || 'Source';
  const lower = new Set([...taken].map(n => n.toLowerCase()));
  let name = `${folder}/${stem}.md`;
  for (let n = 2; lower.has(name.toLowerCase()); n++) name = `${folder}/${stem} ${n}.md`;
  return name;
}

const yaml = (v: string): string => (/^[\w./:@+-]+$/.test(v) && !/^(true|false|null|yes|no|on|off|~)$/i.test(v) && !/^[\d.+-]+$/.test(v) ? v : JSON.stringify(v));

export interface SourceNoteInput {
  title: string;
  /** Where it came from: an address, or null for text that was pasted. */
  url: string | null;
  /** sha256 of the text that was read, hex. */
  hash: string;
  retrievedAt: string;
  /** "provider/model". */
  model: string;
  summary: SourceSummary;
  related: RelatedNote[];
  /** The source was longer than the model was shown, or longer than was kept. */
  clipped: boolean;
  /** Words for the note's own headings, in the language of the app. */
  labels: { summary: string; keyPoints: string; related: string; source: string; pasted: string; clipped: string };
}

const link = (name: string): string => `[[${name.replace(/\.md$/i, '')}]]`;

const row = (kind: 'same' | 'add', line: string): DiffRow => ({ kind, segments: line === '' ? [] : [{ text: line, changed: false }] });

/**
 * The note, twice: without the related links, and with them; and the review of the difference, built here rather than found by comparing
 * the two texts, because a text comparison joins neighbouring added lines into one change and each link is to be kept or dropped on its
 * own. A link is one change: its line and the blank line after it. `tidy` takes the empty heading out when none was kept.
 */
export function composeSourceNote(i: SourceNoteInput): { before: string; after: string; review: Reviewable } {
  const head = [
    '---',
    'type: source',
    `source: ${i.url ? yaml(i.url) : 'pasted'}`,
    `source_hash: sha256:${i.hash}`,
    `retrieved_at: ${i.retrievedAt}`,
    `model: ${yaml(i.model)}`,
    '---',
    `# ${i.title}`,
    '',
    `## ${i.labels.summary}`,
    '',
    i.summary.summary,
    '',
  ];
  if (i.summary.keyPoints.length > 0) head.push(`## ${i.labels.keyPoints}`, '', ...i.summary.keyPoints.map(p => `- ${p}`), '');
  head.push(`## ${i.labels.related}`, '');
  const tail = [`## ${i.labels.source}`, '', i.url ? `<${i.url}>` : i.labels.pasted, ...(i.clipped ? ['', i.labels.clipped] : []), ''];
  const entries = i.related.map(r => `- ${link(r.note)}${r.reason ? `: ${r.reason}` : ''}`);

  const changes: Change[] = entries.map((entry, id) => ({ id, removed: [], added: [row('add', entry), row('add', '')] }));
  const pieces: Piece[] = [
    { kind: 'same', rows: head.map(line => row('same', line)) },
    ...changes.map((c): Piece => ({ kind: 'change', id: c.id })),
    { kind: 'same', rows: tail.map(line => row('same', line)) },
  ];
  return {
    before: [...head, ...tail].join('\n'),
    after: [...head, ...entries.flatMap(e => [e, '']), ...tail].join('\n'),
    review: { pieces, changes },
  };
}

/** The note as it is written: no heading left over an empty list, one blank line between parts. */
export function tidy(note: string, relatedHeading: string): string {
  const escaped = relatedHeading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return note.replace(new RegExp(`## ${escaped}\\n\\n(?=## )`), '').replace(/\n{3,}/g, '\n\n').replace(/\n*$/, '\n');
}
