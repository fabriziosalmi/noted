// How a view's cell shows a frontmatter value. Pure, so what a cell says is tested without a screen.
import type { FieldValue } from '../../shared/vault/fields';
import { isLinkValue, type FieldType } from '../../shared/views/schema';
import { linkLabel } from '../../shared/vault/wikilink';

export type Cell =
  | { kind: 'empty' }
  | { kind: 'text'; text: string; align?: 'right' }
  | { kind: 'check'; checked: boolean }
  | { kind: 'chips'; items: string[] }
  | { kind: 'link'; value: string };

/** What to draw for a value, given the field's type (a value that does not fit the type is shown as plain text). */
export function cellFor(value: FieldValue | undefined, type: FieldType): Cell {
  if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) {
    return type === 'checkbox' ? { kind: 'check', checked: false } : { kind: 'empty' };
  }
  if (Array.isArray(value)) return { kind: 'chips', items: value.filter(v => v !== null).map(String) };
  if (typeof value === 'boolean') return type === 'checkbox' ? { kind: 'check', checked: value } : { kind: 'text', text: String(value) };
  if (typeof value === 'number') return { kind: 'text', text: String(value), align: type === 'number' ? 'right' : undefined };
  if (type === 'link' && isLinkValue(value)) return { kind: 'link', value };
  if (type === 'list' || type === 'select') return { kind: 'chips', items: [value] };
  return { kind: 'text', text: value };
}

/** The text of a cell for assistive technology and for copying. */
export function cellText(cell: Cell): string {
  switch (cell.kind) {
    case 'empty': return '';
    case 'text': return cell.text;
    case 'check': return cell.checked ? '✓' : '';
    case 'chips': return cell.items.map(i => (isLinkValue(i) ? linkLabel(i) : i)).join(', ');
    case 'link': return linkLabel(cell.value);
  }
}

/** The text an editor starts with for a value: lists as comma-separated items. */
export function editorText(value: FieldValue | undefined): string {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.filter(v => v !== null).join(', ');
  return String(value);
}

/**
 * What a cell's editor holds, as the value to write. Empty clears the property (`undefined`); a number field takes a number
 * when the text is one (and keeps the text when it is not, rather than lose it); a list is its comma-separated items.
 */
export function parseCellInput(text: string, type: FieldType): FieldValue | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  if (type === 'number' && Number.isFinite(Number(trimmed))) return Number(trimmed);
  if (type === 'link') return /^\[\[[\s\S]+\]\]$/.test(trimmed) ? trimmed : `[[${trimmed}]]`;
  if (type === 'list') {
    const items = trimmed.split(',').map(i => i.trim()).filter(Boolean);
    return items.length > 0 ? items : undefined;
  }
  return trimmed;
}

/**
 * The type a property is edited as, for one note: what its own value shows when there is one (a number is a number, a true
 * is a checkbox, a `[[note]]` is a link), else what the notes of the vault say about that name, else what was chosen when it
 * was added, else text.
 */
export function propertyType(value: FieldValue | undefined, vaultType: FieldType | undefined, chosen: FieldType | undefined): FieldType {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'checkbox';
  if (Array.isArray(value)) return 'list';
  if (isLinkValue(value)) return 'link';
  if (typeof value === 'string' && value !== '') return vaultType && vaultType !== 'checkbox' && vaultType !== 'list' ? vaultType : 'text';
  return chosen ?? vaultType ?? 'text';
}

/** What a property starts as when it is added with a chosen type: a checkbox is unchecked and a list is empty, the rest are empty. */
export function initialValue(type: FieldType): FieldValue {
  if (type === 'checkbox') return false;
  if (type === 'list') return [];
  return null;
}
