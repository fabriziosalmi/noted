// A note's outline: its headings, in order, and which one the reader is in. Pure over the editor's document, so the
// rules (levels, empty headings, the current one) are tested without a screen.
import type { Node as PMNode } from '@tiptap/pm/model';

export interface OutlineItem {
  /** 1-6, as written. */
  level: number;
  text: string;
  /** Position of the heading in the document, where the editor can scroll to. */
  pos: number;
}

/** Every heading with text, in document order. An empty heading (the title of a new note) is not an entry. */
export function extractOutline(doc: PMNode): OutlineItem[] {
  const items: OutlineItem[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      const text = node.textContent.trim();
      if (text) items.push({ level: Number(node.attrs.level) || 1, text, pos });
      return false; // a heading holds inline text only
    }
    return true;
  });
  return items;
}

/**
 * The heading the position is under: the last one that starts at or before it. Before the first heading there is
 * none (-1).
 */
export function currentHeading(items: readonly OutlineItem[], pos: number): number {
  let current = -1;
  for (let i = 0; i < items.length; i++) {
    if (items[i].pos <= pos) current = i;
    else break;
  }
  return current;
}

/**
 * How far each entry is indented: relative to the shallowest level the note uses (a note that starts at `##`
 * is not indented), and never more than one step deeper than the entry before it (a jump from `#` to `####`
 * is one level of indent, not three).
 */
export function indentLevels(items: readonly OutlineItem[]): number[] {
  if (items.length === 0) return [];
  const base = Math.min(...items.map(i => i.level));
  const out: number[] = [];
  items.forEach((item, i) => {
    const wanted = item.level - base;
    out.push(i === 0 ? 0 : Math.min(wanted, out[i - 1] + 1));
  });
  return out;
}
