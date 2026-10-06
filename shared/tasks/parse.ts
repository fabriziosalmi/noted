/**
 * Tasks in a Markdown note: the `- [ ] text` and `- [x] text` list items, with the due date written either way the
 * Tasks and Dataview plugins write it (`📅 2026-10-10`, `due:: 2026-10-10`, `[due:: 2026-10-10]`). Pure, over the stored
 * text, so the app, the vault index and the MCP server agree on what a task is. Frontmatter and fenced code are not searched.
 */
import { isIsoDate } from '../views/schema';

export interface Task {
  /** 1-based line of the item in the note. */
  line: number;
  done: boolean;
  /** What the task says, without the due date marker. */
  text: string;
  /** `YYYY-MM-DD`, when the task has a due date. */
  due?: string;
  /** `#tags` written in the task itself, lower case. */
  tags: string[];
  /** How deep the item is nested (0 for a top-level item). */
  depth: number;
}

const ITEM = /^(\s*)(?:[-*+]|\d{1,9}[.)])[ \t]+\[([ xX])\][ \t]+(.*?)\s*$/;
const FENCE = /^[ \t]{0,3}(```|~~~)/;
const FRONTMATTER = /^---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/;
const DUE_EMOJI = /\s*(?:📅|🗓️?)[ \t]*(\d{4}-\d{2}-\d{2})/;
const DUE_FIELD = /\s*\[?\bdue::[ \t]*(\d{4}-\d{2}-\d{2})\]?/i;
const TAG = /(?:^|\s)(#[\p{L}\p{N}_\-/]+)/gu;

/** Cheap test before parsing: can this note hold a task at all? */
export const mayHaveTasks = (markdown: string): boolean => /\[[ xX]\]/.test(markdown);

function dueOf(text: string): { text: string; due?: string } {
  for (const pattern of [DUE_EMOJI, DUE_FIELD]) {
    const m = pattern.exec(text);
    if (m && isIsoDate(m[1])) return { text: text.replace(pattern, '').trim(), due: m[1] };
  }
  return { text };
}

/** Every task of the note, in order. */
export function extractTasks(markdown: string): Task[] {
  if (!mayHaveTasks(markdown)) return [];
  const bom = markdown.startsWith('﻿') ? 1 : 0;
  const skip = bom + (FRONTMATTER.exec(markdown.slice(bom))?.[0].length ?? 0);
  const tasks: Task[] = [];
  let fence: string | null = null;
  let at = 0;
  let line = 0;
  for (const raw of markdown.split('\n')) {
    line++;
    const lineStart = at;
    at += raw.length + 1;
    if (lineStart < skip) continue;
    const text = raw.replace(/\r$/, '');
    const fenced = FENCE.exec(text);
    if (fenced) {
      if (fence === null) fence = fenced[1];
      else if (fenced[1] === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const m = ITEM.exec(text);
    if (!m) continue;
    const { text: shown, due } = dueOf(m[3]);
    const tags = [...new Set([...shown.matchAll(TAG)].map(t => t[1].toLowerCase()))];
    const indent = m[1].replace(/\t/g, '    ').length;
    tasks.push({ line, done: m[2] !== ' ', text: shown, ...(due ? { due } : {}), tags, depth: Math.floor(indent / 2) });
  }
  return tasks;
}

/**
 * The note with its task lines blanked, so that the tags the note itself carries can be told from the ones a single task
 * carries: `#urgent` written in one task does not make every other task of the note urgent.
 */
export function withoutTaskLines(markdown: string, tasks: readonly Task[] = extractTasks(markdown)): string {
  if (tasks.length === 0) return markdown;
  const lines = markdown.split('\n');
  for (const t of tasks) lines[t.line - 1] = '';
  return lines.join('\n');
}

export type ToggleResult = { ok: true; content: string } | { ok: false; error: string };

/**
 * The note with the checkbox on `line` set to `done`, if that line still holds the task the caller saw (the same text), so a
 * toggle never lands on the wrong item after the note was edited. Only the one character inside the brackets changes.
 */
export function setTaskDone(markdown: string, line: number, expectedText: string, done: boolean): ToggleResult {
  const lines = markdown.split('\n');
  const raw = lines[line - 1];
  if (raw === undefined) return { ok: false, error: 'the note no longer has that line' };
  const stripped = raw.replace(/\r$/, '');
  const m = ITEM.exec(stripped);
  const current = m ? dueOf(m[3]).text : null;
  if (!m || current !== expectedText) return { ok: false, error: 'that task changed since it was listed' };
  // The checkbox is the first "[ ]" / "[x]" of the item.
  const box = /\[[ xX]\]/.exec(stripped);
  if (!box) return { ok: false, error: 'that task changed since it was listed' };
  const next = stripped.slice(0, box.index) + (done ? '[x]' : '[ ]') + stripped.slice(box.index + 3) + (raw.endsWith('\r') ? '\r' : '');
  if (next === raw) return { ok: true, content: markdown };
  lines[line - 1] = next;
  return { ok: true, content: lines.join('\n') };
}
