/**
 * Running a view: which notes are its rows (the source), which of them pass its filters, and in what order they come.
 * Pure: the notes and their fields go in, rows come out, so every rule is tested without a screen. A row IS a note;
 * nothing here is stored anywhere.
 */
import type { FieldScalar, FieldValue } from '../vault/fields';
import type { View, ViewFilter, ViewSort } from './model';
import { isIsoDate } from './schema';

/** Fields every note has besides its frontmatter, usable as columns and sort keys. */
export const NAME_FIELD = '$name';
export const MODIFIED_FIELD = '$modified';

export interface NoteInfo {
  /** Vault-relative name with ".md". */
  name: string;
  mtimeMs: number;
}

export interface ViewRow {
  name: string;
  /** The note's own name, without folder and ".md". */
  title: string;
  folder: string;
  fields: Readonly<Record<string, FieldValue>>;
  modified: number;
}

export interface ViewContext {
  notes: readonly NoteInfo[];
  frontmatter: Readonly<Record<string, Readonly<Record<string, FieldValue>>>>;
  /** Tag (`#idea`, lower case) -> the notes that have it. */
  tags: Readonly<Record<string, readonly string[]>>;
}

const bare = (name: string): string => name.replace(/\.md$/i, '');

function rowFor(note: NoteInfo, ctx: ViewContext): ViewRow {
  const stem = bare(note.name);
  const slash = stem.lastIndexOf('/');
  return {
    name: note.name,
    title: stem.slice(slash + 1),
    folder: slash === -1 ? '' : stem.slice(0, slash),
    fields: ctx.frontmatter[note.name] ?? {},
    modified: note.mtimeMs,
  };
}

/** The notes a view draws from: all of them, those under a folder (at any depth), or those with a tag. */
export function sourceNotes(view: View, ctx: ViewContext): NoteInfo[] {
  const source = view.source;
  if (source.kind === 'folder') {
    const prefix = `${source.folder.replace(/\/+$/, '').toLowerCase()}/`;
    return ctx.notes.filter(n => n.name.toLowerCase().startsWith(prefix));
  }
  if (source.kind === 'tag') {
    const wanted = new Set(ctx.tags[source.tag.toLowerCase()] ?? []);
    return ctx.notes.filter(n => wanted.has(n.name));
  }
  return [...ctx.notes];
}

// ── values ─────────────────────────────────────────────────────────────────

/** A row's value for a field: the note's own, or a frontmatter one (undefined when the note has none). */
export function valueOf(row: ViewRow, field: string): FieldValue | undefined {
  if (field === NAME_FIELD) return row.title;
  if (field === MODIFIED_FIELD) return row.modified;
  return row.fields[field];
}

const isEmpty = (v: FieldValue | undefined): boolean => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
function items(v: FieldValue | undefined): FieldScalar[] {
  if (Array.isArray(v)) return v;
  return v === undefined ? [] : [v];
}
const lower = (s: FieldScalar): string => String(s).toLowerCase();

const numeric = (v: FieldScalar | undefined): number | null => {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
};

/** Dates compare as the day they name; a time of day, when both have one, decides between two on the same day. */
function dateKey(v: FieldScalar | undefined, operandHasTime: boolean): string | null {
  if (typeof v !== 'string' || !isIsoDate(v)) return null;
  return operandHasTime ? v.replace(' ', 'T') : v.slice(0, 10);
}

function equal(a: FieldScalar, operand: string | number | boolean): boolean {
  if (typeof a === 'boolean') return a === (typeof operand === 'boolean' ? operand : String(operand).toLowerCase() === 'true');
  const na = numeric(a);
  const nb = numeric(operand as FieldScalar);
  if (typeof a === 'number' && nb !== null) return na === nb;
  return lower(a) === lower(operand);
}

/** Does this row pass one filter? A filter that lacks the operand it needs is unfinished, and lets everything pass. */
export function matchesFilter(row: ViewRow, filter: ViewFilter): boolean {
  const value = valueOf(row, filter.field);
  const operand = filter.value;
  const needsOperand = !['is-empty', 'not-empty', 'is-true', 'is-false'].includes(filter.op);
  if (needsOperand && (operand === undefined || operand === '')) return true;
  switch (filter.op) {
    case 'is-empty': return isEmpty(value);
    case 'not-empty': return !isEmpty(value);
    case 'is-true': return value === true;
    case 'is-false': return value !== true; // an unchecked box and a note that never had one are the same thing
    case 'equals':
    case 'has': return items(value).some(i => i !== null && equal(i, operand as string | number | boolean));
    case 'not-equals':
    case 'not-has': return !items(value).some(i => i !== null && equal(i, operand as string | number | boolean));
    case 'contains': return items(value).some(i => i !== null && lower(i).includes(String(operand).toLowerCase()));
    case 'not-contains': return !items(value).some(i => i !== null && lower(i).includes(String(operand).toLowerCase()));
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const a = numeric(Array.isArray(value) ? undefined : value ?? undefined);
      const b = numeric(operand as FieldScalar);
      if (a === null || b === null) return false;
      if (filter.op === 'gt') return a > b;
      if (filter.op === 'gte') return a >= b;
      return filter.op === 'lt' ? a < b : a <= b;
    }
    case 'before':
    case 'after': {
      const withTime = /[T ]\d{2}:/.test(String(operand));
      const a = dateKey(Array.isArray(value) ? undefined : value ?? undefined, withTime);
      const b = dateKey(String(operand), withTime);
      if (a === null || b === null) return false;
      return filter.op === 'before' ? a < b : a > b;
    }
    default: return true;
  }
}

// ── order ──────────────────────────────────────────────────────────────────

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** -1/0/1 for two present values: numbers by size, anything else as text with numbers inside counted as numbers. */
function compareValues(a: FieldValue, b: FieldValue): number {
  const sa = Array.isArray(a) ? a.join(', ') : a;
  const sb = Array.isArray(b) ? b.join(', ') : b;
  if (typeof sa === 'number' && typeof sb === 'number') return sa - sb;
  if (typeof sa === 'boolean' && typeof sb === 'boolean') return Number(sa) - Number(sb);
  return collator.compare(String(sa), String(sb));
}

/** Order rows by every sort key in turn, a note with no value for the key after all that have one, then by name. */
export function sortRows(rows: ViewRow[], sort: readonly ViewSort[]): ViewRow[] {
  return [...rows].sort((x, y) => {
    for (const { field, dir } of sort) {
      const a = valueOf(x, field);
      const b = valueOf(y, field);
      const emptyA = isEmpty(a);
      const emptyB = isEmpty(b);
      if (emptyA && emptyB) continue;
      if (emptyA) return 1; // missing values come last in either direction
      if (emptyB) return -1;
      const c = compareValues(a as FieldValue, b as FieldValue);
      if (c !== 0) return dir === 'desc' ? -c : c;
    }
    if (x.name === y.name) return 0;
    return x.name < y.name ? -1 : 1;
  });
}

/** The sort after a click on a column header: ascending, then descending, then none; the other keys are kept after it. */
export function cycleSort(sort: readonly ViewSort[], field: string): ViewSort[] {
  const others = sort.filter(s => s.field !== field);
  const current = sort.find(s => s.field === field);
  if (!current) return [{ field, dir: 'asc' }, ...others];
  if (current.dir === 'asc') return [{ field, dir: 'desc' }, ...others];
  return others;
}

/** The rows of a view: its source, filtered, ordered. */
export function runView(view: View, ctx: ViewContext): ViewRow[] {
  const rows = sourceNotes(view, ctx).map(n => rowFor(n, ctx)).filter(r => view.filters.every(f => matchesFilter(r, f)));
  return sortRows(rows, view.sort);
}
