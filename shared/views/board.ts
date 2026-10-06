/**
 * A view as a board: one column for each value of a field, a card for each note. Pure, so which note lands in which column,
 * in what order, and what dropping a card on a column means are tested without a screen.
 */
import type { FieldScalar, FieldValue } from '../vault/fields';
import type { FieldType } from './schema';
import type { View } from './model';
import type { ViewRow } from './query';

export interface BoardColumn {
  /** The value of the group field, as text; null for the column of notes with no value. */
  value: string | null;
  rows: ViewRow[];
  /** Listed in the view's `boardColumns` (kept even when empty), rather than found in the notes. */
  pinned: boolean;
}

const isBlank = (v: FieldScalar | undefined): boolean => v === undefined || v === null || v === '';

/** The text a value is a column under. */
export const columnKey = (v: FieldScalar): string => String(v);

/** The values of the group field a note belongs under: one, none (no value), or one per list item. */
export function groupsOf(value: FieldValue | undefined): string[] {
  if (Array.isArray(value)) return [...new Set(value.filter(v => !isBlank(v)).map(v => columnKey(v as FieldScalar)))];
  return isBlank(value) ? [] : [columnKey(value as FieldScalar)];
}

/**
 * The board's columns, left to right: the ones the view lists (even when empty), then any other value found in the notes
 * (the most used first, so a new status shows up beside its neighbours, then by name), then the notes with no value. The
 * rows keep the order they come in, which is the view's sort. A column of "no value" is there only when something is in it.
 */
export function buildBoard(rows: readonly ViewRow[], view: Pick<View, 'groupBy' | 'boardColumns'>): BoardColumn[] {
  const field = view.groupBy;
  if (!field) return [];
  const byValue = new Map<string, ViewRow[]>();
  const without: ViewRow[] = [];
  for (const row of rows) {
    const groups = groupsOf(row.fields[field]);
    if (groups.length === 0) without.push(row);
    for (const g of groups) {
      const list = byValue.get(g);
      if (list) list.push(row);
      else byValue.set(g, [row]);
    }
  }
  const pinned = view.boardColumns ?? [];
  const columns: BoardColumn[] = pinned.map(value => ({ value, rows: byValue.get(value) ?? [], pinned: true }));
  const found = [...byValue.keys()].filter(v => !pinned.includes(v));
  found.sort((a, b) => (byValue.get(b)?.length ?? 0) - (byValue.get(a)?.length ?? 0) || (a < b ? -1 : a > b ? 1 : 0));
  for (const value of found) columns.push({ value, rows: byValue.get(value) ?? [], pinned: false });
  if (without.length > 0) columns.push({ value: null, rows: without, pinned: false });
  return columns;
}

/** What to write in the group field for a card dropped on a column of this value (`undefined`: remove the property). */
export function valueForColumn(column: string | null, type: FieldType): FieldValue | undefined {
  if (column === null) return undefined;
  if (type === 'number' && column.trim() !== '' && Number.isFinite(Number(column))) return Number(column);
  if (type === 'checkbox' && (column === 'true' || column === 'false')) return column === 'true';
  return column;
}

/** Can cards be moved between columns of this field? Not when a note can sit in several (a list). */
export const canMoveCards = (type: FieldType): boolean => type !== 'list';

/** `columns` with `value` added at the end (unless it is there already, or empty), within the model's limit. */
export function withColumn(columns: readonly string[] | undefined, value: string, max: number): string[] {
  const text = value.trim();
  const list = columns ?? [];
  if (!text || list.includes(text) || list.length >= max) return [...list];
  return [...list, text];
}

/** `columns` with the one at `index` moved by `by` places (clamped), for the move-left / move-right buttons. */
export function movedColumn(columns: readonly string[], index: number, by: -1 | 1): string[] {
  const to = index + by;
  if (index < 0 || index >= columns.length || to < 0 || to >= columns.length) return [...columns];
  const out = [...columns];
  [out[index], out[to]] = [out[to], out[index]];
  return out;
}

/** The fields a board can be grouped by: anything that holds one value per note. */
export function groupableFields(schema: readonly { name: string; type: FieldType }[]): string[] {
  return schema.filter(f => canMoveCards(f.type)).map(f => f.name);
}
