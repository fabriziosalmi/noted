// How a view's cell shows a frontmatter value. Pure, so what a cell says is tested without a screen.
import type { FieldValue } from '../../shared/vault/fields';
import type { FieldType } from '../../shared/views/schema';

export type Cell =
  | { kind: 'empty' }
  | { kind: 'text'; text: string; align?: 'right' }
  | { kind: 'check'; checked: boolean }
  | { kind: 'chips'; items: string[] };

/** What to draw for a value, given the field's type (a value that does not fit the type is shown as plain text). */
export function cellFor(value: FieldValue | undefined, type: FieldType): Cell {
  if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) {
    return type === 'checkbox' ? { kind: 'check', checked: false } : { kind: 'empty' };
  }
  if (Array.isArray(value)) return { kind: 'chips', items: value.filter(v => v !== null).map(String) };
  if (typeof value === 'boolean') return type === 'checkbox' ? { kind: 'check', checked: value } : { kind: 'text', text: String(value) };
  if (typeof value === 'number') return { kind: 'text', text: String(value), align: type === 'number' ? 'right' : undefined };
  if (type === 'list' || type === 'select') return { kind: 'chips', items: [value] };
  return { kind: 'text', text: value };
}

/** The text of a cell for assistive technology and for copying. */
export function cellText(cell: Cell): string {
  switch (cell.kind) {
    case 'empty': return '';
    case 'text': return cell.text;
    case 'check': return cell.checked ? '✓' : '';
    case 'chips': return cell.items.join(', ');
  }
}
