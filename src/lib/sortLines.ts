// Line sorting for selected text. Pure string-in/string-out so the rules are tested without an editor.

/** The order lines can be sorted in. */
export type SortDirection = 'asc' | 'desc';

const compareLines = (a: string, b: string): number => a.localeCompare(b, undefined, { sensitivity: 'base' });

/** Sort the lines of `text` case-insensitively. Line count is preserved, including empty lines. */
export function sortSelectedLines(text: string, direction: SortDirection = 'asc'): string {
  const ascending = text.split('\n').sort(compareLines);
  return (direction === 'desc' ? ascending.reverse() : ascending).join('\n');
}

/** Sort ascending, unless the text is already in ascending order, in which case sort descending. */
export function toggleSortLines(text: string): string {
  return sortSelectedLines(text, sortSelectedLines(text) === text ? 'desc' : 'asc');
}
