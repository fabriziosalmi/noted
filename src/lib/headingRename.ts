// Noticing that a heading was renamed, so the links that point at it can follow. Pure, so the rules are tested
// without a screen.

export interface HeadingRename {
  /** Position of the heading among the note's headings. */
  index: number;
  /** Its text now. */
  to: string;
}

/**
 * The headings that were renamed between two readings of a note's headings, or null when their structure changed (one
 * was added or removed: which one became which cannot be told). Only a heading with new, non-empty text counts.
 */
export function diffHeadings(before: readonly string[], after: readonly string[]): HeadingRename[] | null {
  if (before.length !== after.length) return null;
  const renames: HeadingRename[] = [];
  after.forEach((text, index) => {
    if (text !== before[index] && text.trim()) renames.push({ index, to: text });
  });
  return renames;
}
