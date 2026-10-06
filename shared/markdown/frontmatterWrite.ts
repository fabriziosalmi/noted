/**
 * Changing one property in a note's YAML frontmatter without touching anything else.
 *
 * The block is the user's own text, comments and quoting and spacing included, so it is never re-serialized: the value
 * of the one key is found in the source (the YAML library reports where every node starts and ends) and only that span
 * is replaced; a new key is appended after the last line, a removed one is cut out with its line. Every other byte stays
 * exactly as it was, which is what makes a views grid safe to edit with.
 *
 * It refuses rather than guesses: broken YAML, duplicate keys, a value with an anchor, alias or tag, or a key that is not
 * at the top. And after every edit it reads the result back and checks that the key holds what was meant and every
 * other property holds what it held, so a mistake here cannot reach a file.
 */
import { parseDocument, isMap, isScalar, isSeq, stringify, Scalar, type Document, type Pair, type ParsedNode } from 'yaml';
import { fieldsFromFrontmatter, type FieldValue } from '../vault/fields';

export type WriteResult = { ok: true; block: string; changed: boolean } | { ok: false; error: string };

const OPEN = /^---[ \t]*\r?\n/;
const CLOSE = /(?:^|\r?\n)---[ \t]*(?:\r?\n)?$/;

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** A scalar as YAML text: plain when it can be, quoted when it must be; the old quoting style is kept when it still works. */
function scalarText(value: string | number | boolean | null, style?: Scalar['type']): string {
  if (value === null) return '';
  if (typeof value === 'string' && value !== '' && !/[\r\n]/.test(value)) {
    if (style === 'QUOTE_DOUBLE') return JSON.stringify(value);
    // eslint-disable-next-line no-control-regex -- control characters cannot be written in single quotes
    if (style === 'QUOTE_SINGLE' && !/[\u0000-\u001f]/.test(value)) return `'${value.replace(/'/g, "''")}'`;
  }
  return stringify(value, { lineWidth: 0 }).replace(/\r?\n$/, '');
}

function listText(items: readonly (string | number | boolean | null)[], block: boolean, indent: string): string {
  if (items.length === 0) return '[]';
  if (!block) return stringify(items, { collectionStyle: 'flow', lineWidth: 0, flowCollectionPadding: false }).replace(/\r?\n$/, '');
  return items.map(i => `- ${i === null ? 'null' : scalarText(i)}`).join(`\n${indent}`);
}

function keyText(key: string): string {
  return stringify(new Scalar(key), { lineWidth: 0 }).replace(/\r?\n$/, '');
}

/** The index just after the last character of `text` up to `at` that is not whitespace. */
function trimEnd(text: string, at: number): number {
  let end = at;
  while (end > 0 && /\s/.test(text[end - 1])) end--;
  return end;
}

function lineStart(text: string, at: number): number {
  return text.lastIndexOf('\n', at - 1) + 1;
}

function lineEnd(text: string, at: number): number {
  const i = text.indexOf('\n', at);
  return i === -1 ? text.length : i + 1;
}

/** The pair for `key` among the top-level properties, or null. */
function findPair(doc: Document.Parsed, key: string): Pair | null {
  if (!isMap(doc.contents)) return null;
  for (const pair of doc.contents.items) if (isScalar(pair.key) && pair.key.value === key) return pair;
  return null;
}

/**
 * Set `key` to `value` in the frontmatter `block` (as stored, `---` lines included; null when the note has none).
 * `undefined` removes the key, `null` leaves it with an empty value. A list is written in the style the old value had.
 */
export function setFrontmatterField(block: string | null, key: string, value: FieldValue | undefined): WriteResult {
  if (!key.trim() || /[\r\n]/.test(key)) return { ok: false, error: 'invalid property name' };
  const eol = block?.includes('\r\n') ? '\r\n' : '\n';

  if (block === null || block.trim() === '') {
    if (value === undefined) return { ok: true, block: block ?? '', changed: false };
    const line = `${keyText(key)}:${value === null ? '' : ` ${Array.isArray(value) ? listText(value, false, '') : scalarText(value)}`}`;
    return verify(block, `---${eol}${line}${eol}---${eol}`, key, value);
  }

  const open = OPEN.exec(block);
  const close = CLOSE.exec(block);
  if (!open || !close || close.index < open[0].length - 1) return { ok: false, error: 'not a frontmatter block' };
  const innerStart = open[0].length;
  // The closing match owns the line break before its fence, so the inner text ends where that break begins.
  const innerEnd = Math.max(innerStart, close.index);
  const inner = block.slice(innerStart, innerEnd);
  const head = block.slice(0, innerStart);
  const tail = block.slice(innerEnd);

  const doc = parseDocument(inner, { prettyErrors: false });
  if (doc.errors.length > 0) return { ok: false, error: 'the properties are not valid YAML' };
  if (doc.contents !== null && !isMap(doc.contents)) return { ok: false, error: 'the properties are not a list of keys' };

  const pair = findPair(doc, key);
  // Already what was asked: not one byte moves (a list written `[a,b]` stays `[a,b]`).
  if (pair && value !== undefined && same(fieldsFromFrontmatter(block)[key], value)) return { ok: true, block, changed: false };
  let edited: string;

  if (!pair) {
    if (value === undefined) return { ok: true, block, changed: false };
    const line = `${keyText(key)}:${value === null ? '' : ` ${Array.isArray(value) ? listText(value, false, '') : scalarText(value)}`}`;
    const base = inner.replace(/\s+$/, '');
    edited = base === '' ? line : `${base}${eol}${line}`;
  } else {
    const node = pair.value as ParsedNode | null;
    const keyNode = pair.key as Scalar.Parsed;
    const keyRange = keyNode.range;
    if (node && (node.anchor || node.tag || !(isScalar(node) || isSeq(node)))) return { ok: false, error: 'that property has a complex value' };
    if (isSeq(node) && node.items.some(i => !isScalar(i) || i.anchor || i.tag)) return { ok: false, error: 'that property has a complex value' };
    if (isScalar(node) && typeof node.value === 'object' && node.value !== null) return { ok: false, error: 'that property has a complex value' };

    if (value === undefined) {
      const end = trimEnd(inner, node ? Math.max(node.range[2], keyRange[2]) : keyRange[2]);
      edited = inner.slice(0, lineStart(inner, keyRange[0])) + inner.slice(lineEnd(inner, end));
      edited = edited.replace(/\r?\n$/, '');
      // a final line without a newline: the cut can leave the one before it as the last, which is fine
    } else if (!node || (isScalar(node) && node.value === null && node.range[0] === node.range[1])) {
      // `key:` with nothing after it: the value goes after the colon
      const at = node ? node.range[0] : keyRange[2] + 1;
      const text = value === null ? '' : ` ${Array.isArray(value) ? listText(value, false, '') : scalarText(value)}`;
      edited = inner.slice(0, at) + text + inner.slice(at);
    } else {
      const range = node.range;
      let text: string;
      if (Array.isArray(value)) {
        const isBlock = isSeq(node) && !node.flow;
        const column = range[0] - lineStart(inner, range[0]);
        text = listText(value, isBlock && value.length > 0, ' '.repeat(column));
      } else if (isSeq(node) && !node.flow) {
        // a block list becomes one value: the whole list goes, from its first dash to its last item
        text = value === null ? '' : scalarText(value);
      } else {
        text = scalarText(value, isScalar(node) ? node.type : undefined);
      }
      // A block list's range runs on over the line break after its last item: that stays where it is.
      const kept = inner.slice(trimEnd(inner, range[1]), range[1]);
      edited = inner.slice(0, range[0]) + text + (isSeq(node) && !node.flow ? kept : '') + inner.slice(range[1]);
      if (text === '' && range[0] > 0 && inner[range[0] - 1] === ' ') edited = edited.slice(0, range[0] - 1) + edited.slice(range[0]); // `key: ` -> `key:`
    }
  }

  let out: string;
  if (edited === '') out = tail.startsWith('---') ? head + tail : head + tail.replace(/^\r?\n/, '');
  else out = tail.startsWith('---') ? `${head}${edited}${eol}${tail}` : `${head}${edited}${tail}`;
  return verify(block, out, key, value);
}

/** Read the result back: the key holds what was meant and no other property changed. Anything else is refused. */
function verify(before: string | null, after: string, key: string, value: FieldValue | undefined): WriteResult {
  const was = fieldsFromFrontmatter(before);
  const now = fieldsFromFrontmatter(after);
  const expected: Record<string, FieldValue> = { ...was };
  if (value === undefined) delete expected[key];
  else expected[key] = value;
  if (!same(sortKeys(now), sortKeys(expected))) return { ok: false, error: `the edit would not read back as intended${process.env.FM_DEBUG ? `: ${JSON.stringify(after)} gives ${JSON.stringify(now)}, wanted ${JSON.stringify(expected)}` : ''}` };
  return { ok: true, block: after, changed: after !== (before ?? '') };
}

const sortKeys = (o: Record<string, FieldValue>): [string, FieldValue][] => Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

// ── a whole note ───────────────────────────────────────────────────────────

const MD_BLOCK = /^---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/;
const HTML_BLOCK = /<!--noted-frontmatter:([\s\S]*?)-->/;

/** The frontmatter block of a note exactly as it is stored, or null: the first thing in a Markdown note, a comment in an HTML one. */
export function readStoredFrontmatter(raw: string, format: 'markdown' | 'html'): string | null {
  if (format === 'markdown') return MD_BLOCK.exec(raw.replace(/^\uFEFF/, ''))?.[0] ?? null;
  const match = HTML_BLOCK.exec(raw);
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch { return null; }
}

export type NoteWriteResult = { ok: true; content: string; changed: boolean } | { ok: false; error: string };

/** Set (or, with `undefined`, remove) one property in the stored text of a note; every other byte of the note is kept. */
export function setNoteProperty(raw: string, format: 'markdown' | 'html', key: string, value: FieldValue | undefined): NoteWriteResult {
  if (format === 'markdown') {
    const bom = raw.startsWith('\uFEFF') ? '\uFEFF' : '';
    const text = bom ? raw.slice(1) : raw;
    const block = MD_BLOCK.exec(text)?.[0] ?? null;
    const result = setFrontmatterField(block, key, value);
    if (!result.ok) return result;
    if (!result.changed) return { ok: true, content: raw, changed: false };
    // A note that had no block gets one, set apart from the text by a blank line like the app writes them.
    const rest = block === null ? text : text.slice(block.length);
    const gap = block === null && rest !== '' && !rest.startsWith('\n') ? '\n' : '';
    return { ok: true, content: `${bom}${result.block}${gap}${rest}`, changed: true };
  }
  const match = HTML_BLOCK.exec(raw);
  let block: string | null = null;
  if (match) {
    try { block = decodeURIComponent(match[1]); } catch { return { ok: false, error: 'the properties of this note cannot be read' }; }
  }
  const result = setFrontmatterField(block, key, value);
  if (!result.ok) return result;
  if (!result.changed) return { ok: true, content: raw, changed: false };
  const comment = `<!--noted-frontmatter:${encodeURIComponent(result.block.replace(/\r?\n$/, ''))}-->`;
  const content = match ? raw.slice(0, match.index) + comment + raw.slice(match.index + match[0].length) : `${comment}\n${raw}`;
  return { ok: true, content, changed: true };
}
