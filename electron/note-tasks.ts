/**
 * Ticking a task from the Tasks view: the note's file is the only truth, so this reads it, flips the one checkbox if that
 * line still holds the task the caller saw, keeps the previous version in the note's history, and writes it back atomically.
 */
import { setTaskDone } from '../shared/tasks/parse.js';
import type { NoteFormat } from '../shared/vault/format.js';

export interface TaskDeps {
  readNote: (name: string) => Promise<string>;
  snapshotBefore: (name: string, previousContent: string) => Promise<void>;
  writeNote: (name: string, content: string) => Promise<void>;
  format: NoteFormat;
}

export type TaskToggle = { ok: true; changed: boolean } | { ok: false; error: string; changed?: undefined };

export async function toggleTask(deps: TaskDeps, name: string, line: number, text: string, done: boolean): Promise<TaskToggle> {
  if (deps.format !== 'markdown') return { ok: false, error: 'tasks can be changed in a Markdown vault only' };
  let raw: string;
  try { raw = await deps.readNote(name); } catch { return { ok: false, error: 'note not found' }; }
  const result = setTaskDone(raw, line, text, done);
  if (!result.ok) return { ok: false, error: result.error };
  if (result.content === raw) return { ok: true, changed: false };
  await deps.snapshotBefore(name, raw);
  await deps.writeNote(name, result.content);
  return { ok: true, changed: true };
}
