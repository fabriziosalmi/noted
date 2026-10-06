/**
 * Which tasks to show, and in what order: the filters of the Tasks view and of the MCP `list_tasks` tool, one set of rules.
 * Pure; "today" is given, never read, so a result depends only on what it is asked.
 */
import type { Task } from './parse';

export interface NoteTask extends Task {
  /** Vault-relative note name, with ".md". */
  note: string;
  /** The note's own tags, lower case with `#`. */
  noteTags: string[];
}

export interface TaskFilter {
  /** `open` (default), `done` or `all`. */
  status?: 'open' | 'done' | 'all';
  /** Only notes under this folder, at any depth. */
  folder?: string;
  /** Only tasks that carry this tag themselves or whose note does (`#idea` or `idea`). */
  tag?: string;
  /** Due on or after / on or before this day (`YYYY-MM-DD`). A task with no due date never passes a date bound. */
  dueFrom?: string;
  dueTo?: string;
  /** Open tasks due before today. */
  overdue?: boolean;
  /** Only tasks with no due date. */
  noDue?: boolean;
  /** Only tasks whose text contains this (case-insensitive). */
  text?: string;
}

const normalizeTag = (tag: string): string => (tag.startsWith('#') ? tag : `#${tag}`).toLowerCase();

export function matchesTask(task: NoteTask, filter: TaskFilter, today: string): boolean {
  const status = filter.status ?? 'open';
  if (status === 'open' && task.done) return false;
  if (status === 'done' && !task.done) return false;
  if (filter.folder) {
    const prefix = `${filter.folder.replace(/^\/+|\/+$/g, '').toLowerCase()}/`;
    if (!task.note.toLowerCase().startsWith(prefix)) return false;
  }
  if (filter.tag) {
    const tag = normalizeTag(filter.tag);
    if (!task.tags.includes(tag) && !task.noteTags.includes(tag)) return false;
  }
  if (filter.noDue && task.due) return false;
  if (filter.overdue && !(task.due && task.due < today && !task.done)) return false;
  if (filter.dueFrom && !(task.due && task.due >= filter.dueFrom)) return false;
  if (filter.dueTo && !(task.due && task.due <= filter.dueTo)) return false;
  if (filter.text && !task.text.toLowerCase().includes(filter.text.toLowerCase())) return false;
  return true;
}

/** With a due date, the soonest first; with none, after them; then by note and line, so the order never shuffles. */
export function compareTasks(a: NoteTask, b: NoteTask): number {
  if (a.due !== b.due) {
    if (!a.due) return 1;
    if (!b.due) return -1;
    return a.due < b.due ? -1 : 1;
  }
  if (a.note !== b.note) return a.note < b.note ? -1 : 1;
  return a.line - b.line;
}

export function queryTasks(tasks: readonly NoteTask[], filter: TaskFilter, today: string): NoteTask[] {
  return tasks.filter(t => matchesTask(t, filter, today)).sort(compareTasks);
}

/** `YYYY-MM-DD` for a date, in the machine's own time zone (what "today" means to the person). */
export function localDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The day `days` after `day`. */
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return localDay(new Date(y, m - 1, d + days));
}

export type DuePreset = 'any' | 'overdue' | 'today' | 'week' | 'none';

/** The filter fields a due-date choice stands for, given today. "Week" is today and the six days after it. */
export function dueFilter(preset: DuePreset, today: string): Pick<TaskFilter, 'dueFrom' | 'dueTo' | 'overdue' | 'noDue'> {
  switch (preset) {
    case 'overdue': return { overdue: true };
    case 'today': return { dueFrom: today, dueTo: today };
    case 'week': return { dueFrom: today, dueTo: addDays(today, 6) };
    case 'none': return { noDue: true };
    default: return {};
  }
}
