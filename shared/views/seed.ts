/**
 * What a note made from inside a view starts with, so that it belongs to the view the moment it exists: the view's folder or
 * tag, the value of the board column it was added to, and the value of any "is" filter (a note that does not pass the view's
 * own filters would vanish as soon as it was made). Pure.
 */
import { setFrontmatterField } from '../markdown/frontmatterWrite';
import type { FieldValue } from '../vault/fields';
import type { View } from './model';
import { valueForColumn } from './board';
import type { FieldType } from './schema';

export interface NoteSeed {
  /** The folder the note goes in; empty for the top of the vault. */
  folder: string;
  /** A tag the note starts with (`#idea`), when the view draws from a tag. */
  tag?: string;
  /** The properties it starts with. */
  fields: Record<string, FieldValue>;
}

/**
 * `column` is the board column the note is added to (null: the "no value" column; undefined: not from a board column).
 * `typeOf` gives a field's type, so that a number filter seeds a number.
 */
export function seedFor(view: View, typeOf: (field: string) => FieldType, column?: string | null): NoteSeed {
  const fields: Record<string, FieldValue> = {};
  for (const filter of view.filters) {
    const type = typeOf(filter.field);
    if (filter.field.startsWith('$')) continue;
    if (filter.op === 'is-true') fields[filter.field] = true;
    else if (filter.op === 'equals' && filter.value !== undefined && filter.value !== '') {
      fields[filter.field] = typeof filter.value === 'string' ? (valueForColumn(filter.value, type) ?? filter.value) : filter.value;
    } else if (filter.op === 'has' && filter.value !== undefined && filter.value !== '') fields[filter.field] = [String(filter.value)];
  }
  if (column !== undefined && view.groupBy) {
    const value = valueForColumn(column, typeOf(view.groupBy));
    if (value === undefined) delete fields[view.groupBy];
    else fields[view.groupBy] = value;
  }
  return {
    folder: view.source.kind === 'folder' ? view.source.folder : '',
    ...(view.source.kind === 'tag' ? { tag: view.source.tag } : {}),
    fields,
  };
}

/** The frontmatter block (as the editor carries it: `---` lines, no final newline) for the seed's properties, or null. */
export function seedBlock(fields: Record<string, FieldValue>): string | null {
  let block: string | null = null;
  for (const [key, value] of Object.entries(fields)) {
    const result = setFrontmatterField(block, key, value);
    if (result.ok) block = result.block;
  }
  return block === null ? null : block.replace(/\r?\n$/, '');
}
