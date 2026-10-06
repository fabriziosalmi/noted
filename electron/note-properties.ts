/**
 * Changing one property of one note on disk: the cell of a view, the card dragged to another column, a panel's field.
 * The note's file is the only truth, so this reads it, changes only that property's text (see
 * shared/markdown/frontmatterWrite.ts), keeps the previous version in the note's history, and writes it back atomically.
 *
 * It is compare-and-set: the caller says what it believed the property was, and if the file says something else (it was
 * changed by hand, by a sync, by another view) nothing is written and the caller is told, so a stale grid can never
 * overwrite a newer value.
 */
import { setNoteProperty } from '../shared/markdown/frontmatterWrite.js';
import { extractFields } from '../shared/vault/extract.js';
import type { FieldValue } from '../shared/vault/fields.js';
import type { NoteFormat } from '../shared/vault/format.js';

export interface PropertyDeps {
  readNote: (name: string) => Promise<string>;
  /** Keep the PREVIOUS content in the note's history. */
  snapshotBefore: (name: string, previousContent: string) => Promise<void>;
  /** Durable, atomic write, plus whatever index bookkeeping the caller does. */
  writeNote: (name: string, content: string) => Promise<void>;
  format: NoteFormat;
}

export type PropertyOutcome =
  | { ok: true; changed: boolean; fields: Record<string, FieldValue> }
  | { ok: false; error: string; conflict?: boolean; fields?: Record<string, FieldValue> };

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Set `key` to `value` in note `name`; `undefined` removes the property. With `expect`, only if the property currently
 * holds `expect.value` (`undefined` meaning it is not there).
 */
export async function setProperty(
  deps: PropertyDeps,
  name: string,
  key: string,
  value: FieldValue | undefined,
  expect?: { value: FieldValue | undefined },
): Promise<PropertyOutcome> {
  let raw: string;
  try { raw = await deps.readNote(name); } catch { return { ok: false, error: 'note not found' }; }

  const current = extractFields(raw, deps.format);
  if (expect && !same(current[key], expect.value)) {
    return { ok: false, error: 'the property changed since it was read', conflict: true, fields: current };
  }
  const result = setNoteProperty(raw, deps.format, key, value);
  if (!result.ok) return { ok: false, error: result.error };
  if (!result.changed) return { ok: true, changed: false, fields: current };

  await deps.snapshotBefore(name, raw);
  await deps.writeNote(name, result.content);
  return { ok: true, changed: true, fields: extractFields(result.content, deps.format) };
}
