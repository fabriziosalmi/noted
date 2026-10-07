// Where a quick capture goes. Pure: the file work is in electron/capture-write.ts. A capture is either a note of its own, a line
// added to today's daily note, or a line added to a standing Inbox note, and the last two are appended in the vault's own format.
import { normalizeMarkdown, plainTextToMarkdown } from '../markdown/codec';
import type { NoteFormat } from '../vault/format';

export type CaptureTarget = 'new' | 'daily' | 'inbox';
export const CAPTURE_TARGETS: readonly CaptureTarget[] = ['new', 'daily', 'inbox'];
export const INBOX_NOTE = 'Inbox.md';

/** What came over IPC, or out of storage, as a target: anything else is a new note, the behaviour before there were targets. */
export const toCaptureTarget = (value: unknown): CaptureTarget =>
  CAPTURE_TARGETS.find((t) => t === value) ?? 'new';

const pad = (n: number): string => String(n).padStart(2, '0');
export const dailyFileName = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.md`;
export const clockTime = (d: Date): string => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const lines = (text: string): string[] => text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '');

/** The captured text as the paragraphs to add, the first one led by the time it was captured. */
export function captureBlock(text: string, time: string, format: NoteFormat): string {
  const parts = lines(text);
  if (parts.length === 0) return '';
  if (format === 'html') {
    return parts.map((p, i) => `<p>${i === 0 ? `<strong>${time}</strong> ` : ''}${escapeHtml(p)}</p>`).join('');
  }
  const body = plainTextToMarkdown(text).trim();
  return `**${time}** ${body}`;
}

export interface DailySections { title: string; notes: string; todo: string; ideas: string }

/** A new daily note: the same title and sections the app makes when you open today's note yourself. */
export function newDailyNote(s: DailySections, format: NoteFormat): string {
  if (format === 'html') {
    const h = escapeHtml;
    return `<h1>${h(s.title)}</h1><h2>${h(s.notes)}</h2><p></p><h2>${h(s.todo)}</h2><ul><li><p></p></li></ul><h2>${h(s.ideas)}</h2><p></p>`;
  }
  return normalizeMarkdown(`# ${s.title}\n\n## ${s.notes}\n\n## ${s.todo}\n\n- \n\n## ${s.ideas}\n`);
}

export function newInboxNote(title: string, format: NoteFormat): string {
  return format === 'html' ? `<h1>${escapeHtml(title)}</h1>` : normalizeMarkdown(`# ${title}\n`);
}

/** Index of each line that opens a second-level section, leaving out front matter and fenced code. */
function sectionStarts(source: string[]): number[] {
  const starts: number[] = [];
  let i = 0;
  if (source[0]?.trim() === '---') {
    const end = source.findIndex((l, n) => n > 0 && l.trim() === '---');
    if (end > 0) i = end + 1;
  }
  let fence: string | null = null;
  for (; i < source.length; i++) {
    const line = source[i];
    const f = /^\s*(```+|~~~+)/.exec(line)?.[1];
    if (f) {
      if (fence === null) fence = f[0];
      else if (f[0] === fence) fence = null;
      continue;
    }
    if (fence === null && /^##\s/.test(line)) starts.push(i);
  }
  return starts;
}

/**
 * `block` added to `content`. With `firstSection`, a note laid out in sections (the daily note) takes it at the end of the first one,
 * where a quick line belongs, rather than under the last heading; a note with fewer than two sections takes it at the end.
 */
export function insertCapture(content: string, block: string, format: NoteFormat, firstSection: boolean): string {
  if (format === 'html') {
    const second = firstSection ? [...content.matchAll(/<h2\b/gi)][1]?.index : undefined;
    if (second === undefined) return `${content}${block}`;
    // The empty paragraph a new section opens with is where the line goes, not a gap above it.
    const head = content.slice(0, second).replace(/<p><\/p>$/, '');
    return `${head}${block}${content.slice(second)}`;
  }
  const source = content.replace(/\s+$/, '').split('\n');
  const second = firstSection ? sectionStarts(source)[1] : undefined;
  if (second === undefined) return `${source.join('\n')}\n\n${block}\n`;
  const head = source.slice(0, second).join('\n').replace(/\s+$/, '');
  return `${head}\n\n${block}\n\n${source.slice(second).join('\n')}\n`;
}
