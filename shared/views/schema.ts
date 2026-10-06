/**
 * What the notes' frontmatter says about itself: which fields exist, how many notes have each, and what type each is,
 * worked out from the values (there is no declared schema; the YAML is the only truth). Column pickers, cell editors,
 * filters and board columns are all driven from this. Pure and order-independent: the same notes always give the same
 * answer, whatever order they are listed in.
 */
import type { FieldScalar, FieldValue } from '../vault/fields';

export type FieldType = 'text' | 'number' | 'date' | 'select' | 'checkbox' | 'list';

export interface FieldOption {
  value: string;
  /** How many notes have it. */
  count: number;
}

export interface FieldInfo {
  name: string;
  type: FieldType;
  /** Notes that give the field a value (an empty `key:` is not one). */
  count: number;
  /** Notes that have the key at all, empty or not. */
  present: number;
  /** The values that are used, most used first, for `select` and `list` fields (bounded). */
  options: FieldOption[];
  /** The notes disagree about what kind of value it is (numbers and words, a list here and a word there). */
  mixed: boolean;
}

export const MAX_OPTIONS = 100;
/** A text field with at most this many different values is a choice, however few notes use it. */
export const SELECT_ALWAYS_UP_TO = 5;
/** ...and one with up to this many, when most of them repeat. */
export const SELECT_REPEATING_UP_TO = 20;
/** Values longer than this on average are prose, not a choice. */
export const SELECT_MAX_AVG_CHARS = 40;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/** Is this text a date as YAML notes write them: `2026-10-06`, or with a time? Month and day must exist. */
export function isIsoDate(text: string): boolean {
  if (!ISO_DATE.test(text)) return false;
  const [y, m, d] = text.slice(0, 10).split('-').map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const kindOf = (v: FieldScalar): 'null' | 'boolean' | 'number' | 'date' | 'text' => {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'number') return 'number';
  return isIsoDate(v) ? 'date' : 'text';
};

// By code point, not by the machine's locale: the same notes list the same way everywhere.
function byText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

const optionsOf = (counts: Map<string, number>): FieldOption[] =>
  [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || byText(a.value, b.value))
    .slice(0, MAX_OPTIONS);

/** The fields of a vault, from its notes' frontmatter, the ones most notes have first. */
export function inferSchema(index: Readonly<Record<string, Readonly<Record<string, FieldValue>>>>): FieldInfo[] {
  const byField = new Map<string, FieldValue[]>();
  for (const fields of Object.values(index)) {
    for (const [name, value] of Object.entries(fields)) {
      const values = byField.get(name);
      if (values) values.push(value);
      else byField.set(name, [value]);
    }
  }
  const out: FieldInfo[] = [];
  for (const [name, values] of byField) out.push(inferField(name, values));
  return out.sort((a, b) => b.count - a.count || byText(a.name, b.name));
}

/** One field, from the value it has in each note that has it. */
export function inferField(name: string, values: readonly FieldValue[]): FieldInfo {
  const present = values.length;
  const scalars: FieldScalar[] = [];
  let anyList = false;
  let anyScalar = false;
  let count = 0;
  const used = new Map<string, number>(); // distinct scalar text -> notes using it
  for (const value of values) {
    const items = Array.isArray(value) ? value : [value];
    if (Array.isArray(value)) anyList = true;
    else if (value !== null) anyScalar = true;
    const meaningful = items.filter(i => i !== null && i !== '');
    if (meaningful.length === 0) continue;
    count++;
    scalars.push(...meaningful);
    for (const text of new Set(meaningful.map(String))) used.set(text, (used.get(text) ?? 0) + 1);
  }

  const kinds = new Set(scalars.map(kindOf));
  const base = { name, count, present };
  if (anyList) {
    // A list in some notes and a single word in others is still a list: a lone value is a list of one.
    return { ...base, type: 'list', options: optionsOf(used), mixed: anyScalar };
  }
  if (kinds.size === 0) return { ...base, type: 'text', options: [], mixed: false };
  if (kinds.size === 1) {
    const [only] = [...kinds];
    if (only === 'boolean') return { ...base, type: 'checkbox', options: [], mixed: false };
    if (only === 'number') return { ...base, type: 'number', options: [], mixed: false };
    if (only === 'date') return { ...base, type: 'date', options: [], mixed: false };
    const distinct = used.size;
    const totalChars = scalars.reduce<number>((n, v) => n + String(v).length, 0);
    const choice = distinct <= SELECT_ALWAYS_UP_TO || (distinct <= SELECT_REPEATING_UP_TO && distinct <= count / 2);
    if (choice && totalChars / scalars.length <= SELECT_MAX_AVG_CHARS) return { ...base, type: 'select', options: optionsOf(used), mixed: false };
    return { ...base, type: 'text', options: [], mixed: false };
  }
  // The notes disagree (numbers and words, a date and "next week"): text is the type that can hold anything.
  return { ...base, type: 'text', options: [], mixed: true };
}
