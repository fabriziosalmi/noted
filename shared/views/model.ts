/**
 * What a "view" is: a saved query over the notes' frontmatter, shown as a table or a board. There is no separate
 * database: a view stores only where its rows come from, how they are filtered and ordered, and what to show; every
 * row IS a note file. The model is plain JSON that lives in the vault (`.noted-views.json`), so it can be read, edited
 * and synced like the notes themselves, which means it is read defensively: whatever is in the file, the app gets
 * well-formed views or none.
 */

export const VIEWS_FILE = '.noted-views.json';
export const VIEWS_FILE_VERSION = 1;

export const MAX_VIEWS = 200;
export const MAX_NAME_CHARS = 80;
export const MAX_FILTERS = 20;
export const MAX_SORTS = 5;
export const MAX_COLUMNS = 50;
export const MAX_FIELD_CHARS = 200;
export const MAX_VALUE_CHARS = 500;
export const MAX_SOURCE_CHARS = 200;

export type ViewLayout = 'table' | 'board';

export type ViewSource =
  | { kind: 'all' }
  | { kind: 'folder'; folder: string }
  | { kind: 'tag'; tag: string };

/** What a filter asks of one field; which are offered for a field depends on its type (see schema.ts). */
export const FILTER_OPS = [
  'equals', 'not-equals', 'contains', 'not-contains', 'is-empty', 'not-empty',
  'gt', 'gte', 'lt', 'lte', 'before', 'after', 'is-true', 'is-false', 'has', 'not-has',
] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

export interface ViewFilter {
  field: string;
  op: FilterOp;
  /** The operand; absent for the operators that take none (is-empty, is-true...). */
  value?: string | number | boolean;
}

export interface ViewSort {
  field: string;
  dir: 'asc' | 'desc';
}

export interface View {
  id: string;
  name: string;
  source: ViewSource;
  filters: ViewFilter[];
  sort: ViewSort[];
  /** The field a board's columns are made of. */
  groupBy?: string;
  /** The fields shown as table columns, in order (the note's name is always the first column). */
  columns: string[];
  layout: ViewLayout;
}

export interface ViewsFile {
  version: number;
  views: View[];
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() && v.length <= max ? v : null);

function normalizeSource(raw: unknown): ViewSource {
  if (!isRecord(raw)) return { kind: 'all' };
  if (raw.kind === 'folder') {
    const folder = text(raw.folder, MAX_SOURCE_CHARS)?.replace(/^\/+|\/+$/g, '');
    return folder ? { kind: 'folder', folder } : { kind: 'all' };
  }
  if (raw.kind === 'tag') {
    const tag = text(raw.tag, MAX_SOURCE_CHARS);
    return tag ? { kind: 'tag', tag: tag.startsWith('#') ? tag : `#${tag}` } : { kind: 'all' };
  }
  return { kind: 'all' };
}

function normalizeFilter(raw: unknown): ViewFilter | null {
  if (!isRecord(raw)) return null;
  const field = text(raw.field, MAX_FIELD_CHARS);
  const op = FILTER_OPS.find(o => o === raw.op);
  if (!field || !op) return null;
  const value = raw.value;
  if (typeof value === 'string' && value.length <= MAX_VALUE_CHARS) return { field, op, value };
  if ((typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean') return { field, op, value };
  return { field, op };
}

function normalizeSort(raw: unknown): ViewSort | null {
  if (!isRecord(raw)) return null;
  const field = text(raw.field, MAX_FIELD_CHARS);
  return field ? { field, dir: raw.dir === 'desc' ? 'desc' : 'asc' } : null;
}

const list = <T>(raw: unknown, max: number, one: (item: unknown) => T | null): T[] =>
  (Array.isArray(raw) ? raw : []).slice(0, max * 2).map(one).filter((x): x is T => x !== null).slice(0, max);

/** One view from whatever was stored, or null when it is not a view at all (no usable name). */
export function normalizeView(raw: unknown, takenIds: ReadonlySet<string> = new Set()): View | null {
  if (!isRecord(raw)) return null;
  const name = text(raw.name, MAX_NAME_CHARS)?.trim();
  if (!name) return null;
  let id = typeof raw.id === 'string' && ID.test(raw.id) ? raw.id : '';
  if (!id || takenIds.has(id)) id = ''; // the caller gives such a view a fresh id
  const columns = [...new Set(list(raw.columns, MAX_COLUMNS, c => text(c, MAX_FIELD_CHARS)))];
  const groupBy = text(raw.groupBy, MAX_FIELD_CHARS) ?? undefined;
  return {
    id,
    name,
    source: normalizeSource(raw.source),
    filters: list(raw.filters, MAX_FILTERS, normalizeFilter),
    sort: list(raw.sort, MAX_SORTS, normalizeSort),
    ...(groupBy ? { groupBy } : {}),
    columns,
    layout: raw.layout === 'board' ? 'board' : 'table',
  };
}

/**
 * The views of a parsed views file. Never throws: a file that is not a views file gives none, a bad view is dropped,
 * a missing or repeated id is replaced by a fresh one from `makeId`.
 */
export function normalizeViews(raw: unknown, makeId: () => string): View[] {
  const items = isRecord(raw) ? raw.views : null;
  if (!Array.isArray(items)) return [];
  const taken = new Set<string>();
  const out: View[] = [];
  for (const item of items.slice(0, MAX_VIEWS * 2)) {
    const view = normalizeView(item, taken);
    if (!view) continue;
    if (!view.id) {
      do { view.id = makeId(); } while (taken.has(view.id));
    }
    taken.add(view.id);
    out.push(view);
    if (out.length >= MAX_VIEWS) break;
  }
  return out;
}

/** The file's text: stable, indented and ending in a newline, so a change to one view is a small diff in Git. */
export function serializeViews(views: readonly View[]): string {
  // Keys in one fixed order, so the same views are always the same bytes.
  const ordered = views.map(v => ({
    id: v.id, name: v.name, layout: v.layout, source: v.source, filters: v.filters, sort: v.sort,
    ...(v.groupBy ? { groupBy: v.groupBy } : {}), columns: v.columns,
  }));
  const file: ViewsFile = { version: VIEWS_FILE_VERSION, views: ordered };
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** A fresh view id: `v-` and ten hex digits. */
export function newViewId(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(5));
  return `v-${[...bytes].map(b => b.toString(16).padStart(2, '0')).join('')}`;
}

/** A new view with sensible defaults: every note, a table, no filters. */
export function blankView(id: string, name: string, patch: Partial<Omit<View, 'id' | 'name'>> = {}): View {
  return { id, name, source: { kind: 'all' }, filters: [], sort: [], columns: [], layout: 'table', ...patch };
}
