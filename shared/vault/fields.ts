/**
 * A note's frontmatter as typed fields, for the vault-wide field index that Views are built on. Read-only and
 * tolerant, like aliases: a note with broken YAML has no fields, never an error.
 *
 * Values are plain JSON so they travel to the renderer as they are: a string, number or boolean, null (a key with no
 * value), or a list of those. A nested mapping or a list of mappings is not a field (it cannot be a table cell), and
 * a date stays the text it was written as (the YAML core schema does not turn `2026-10-06` into a Date), so a note's
 * file and its cell always agree.
 */
import { parseFrontmatterBlock } from '../markdown/yamlFrontmatter';

export type FieldScalar = string | number | boolean | null;
export type FieldValue = FieldScalar | FieldScalar[];

export const MAX_FIELDS = 100;
export const MAX_FIELD_TEXT = 1000;
export const MAX_LIST_ITEMS = 100;

const scalar = (value: unknown): FieldScalar | undefined => {
  if (value === null) return null;
  if (typeof value === 'string') return value.length > MAX_FIELD_TEXT ? value.slice(0, MAX_FIELD_TEXT) : value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean') return value;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  return undefined;
};

function fieldValue(value: unknown): FieldValue | undefined {
  if (Array.isArray(value)) {
    const items: FieldScalar[] = [];
    for (const item of value.slice(0, MAX_LIST_ITEMS)) {
      const one = scalar(item);
      if (one === undefined) return undefined; // a list holding a mapping or a list is not a cell
      items.push(one);
    }
    return items;
  }
  return scalar(value);
}

// The YAML library costs about 100 µs a block, which is a second on a 10,000-note vault, for what is nearly always a
// few `key: value` lines. Those are read directly; anything that needs real YAML (quotes, anchors, multi-line values,
// block lists, comments, special values) makes the whole block go to the library, so the answer is always the same.
const KEY = /^[A-Za-z_][\w-]*$/;
const PLAIN = /^[^\s#&*!|>'"%@`{}[\],:?-][^#:[\]{},]*$/; // one plain word or phrase: no YAML syntax inside
const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;
const SPECIAL = /^(?:true|false|null|~|[-+]?\.(?:inf|nan)|0x[\da-f]+|0o[0-7]+)$/i;

function plainScalar(text: string): FieldScalar | undefined {
  if (text === '') return null;
  if (/^(?:true|false)$/i.test(text)) return text.toLowerCase() === 'true';
  if (NUMBER.test(text)) return Number(text);
  if (SPECIAL.test(text) || !PLAIN.test(text) || /\s$/.test(text)) return undefined;
  return text.length > MAX_FIELD_TEXT ? text.slice(0, MAX_FIELD_TEXT) : text;
}

function fastFields(block: string): Record<string, FieldValue> | null {
  const lines = block.split(/\r?\n/);
  if (!/^---[ \t]*$/.test(lines[0] ?? '')) return null;
  const out: Record<string, FieldValue> = {};
  let closed = false;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^---[ \t]*$/.test(line)) { closed = true; if (lines.slice(i + 1).some(l => l.trim())) return null; break; }
    if (line.trim() === '') return null; // keep the blank-line and comment cases in one place: the library
    const split = line.indexOf(': ');
    const key = split === -1 ? (line.endsWith(':') ? line.slice(0, -1) : '') : line.slice(0, split);
    if (!KEY.test(key) || SPECIAL.test(key) || key in out) return null; // a key like `null` or `true` is not text to YAML
    const rest = split === -1 ? '' : line.slice(split + 2).trim();
    const next = lines[i + 1] ?? '';
    if (rest === '' && /^[ \t-]/.test(next)) return null; // a block list or mapping follows
    if (rest.startsWith('[') && rest.endsWith(']')) {
      const inner = rest.slice(1, -1).trim();
      const items: FieldScalar[] = [];
      for (const part of inner === '' ? [] : inner.split(',')) {
        const one = plainScalar(part.trim());
        if (one === undefined || one === null && part.trim() === '') return null;
        items.push(one);
      }
      if (items.length > MAX_LIST_ITEMS) return null;
      out[key] = items;
    } else {
      const value = plainScalar(rest);
      if (value === undefined) return null;
      out[key] = value;
    }
    if (Object.keys(out).length > MAX_FIELDS) return null;
  }
  return closed ? out : null;
}

/** The library's reading of a block: the answer the fast path must always equal. */
export function fieldsViaLibrary(block: string): Record<string, FieldValue> {
  const { data } = parseFrontmatterBlock(block);
  if (!data) return {};
  const out: Record<string, FieldValue> = {};
  for (const [key, raw] of Object.entries(data)) {
    if (Object.keys(out).length >= MAX_FIELDS) break;
    const value = fieldValue(raw);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** `block` is a frontmatter block as stored, `---` lines included (null when the note has none). */
export function fieldsFromFrontmatter(block: string | null): Record<string, FieldValue> {
  if (!block) return {};
  return fastFields(block) ?? fieldsViaLibrary(block);
}
