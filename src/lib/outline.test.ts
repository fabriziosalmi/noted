import { describe, expect, it } from 'vitest';
import { documentSchema } from '../../shared/markdown/schema';
import { currentHeading, extractOutline, indentLevels, type OutlineItem } from './outline';

const heading = (level: number, text: string) => ({ type: 'heading', attrs: { level }, content: text ? [{ type: 'text', text }] : undefined });
const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const doc = (...content: object[]) => documentSchema().nodeFromJSON({ type: 'doc', content });

describe('extractOutline', () => {
  it('lists the headings in order, with their level and where they are', () => {
    const d = doc(heading(1, 'Title'), para('intro'), heading(2, 'Part one'), para('text'), heading(3, 'Detail'), heading(2, 'Part two'));
    const items = extractOutline(d);
    expect(items.map(i => [i.level, i.text])).toEqual([[1, 'Title'], [2, 'Part one'], [3, 'Detail'], [2, 'Part two']]);
    for (const item of items) expect(d.nodeAt(item.pos)!.type.name).toBe('heading'); // positions point at the headings
  });

  it('skips an empty heading (a new note\'s title), and finds headings in a list, a quote and a callout', () => {
    const d = doc(
      heading(1, ''),
      { type: 'blockquote', content: [heading(2, 'Quoted')] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [heading(3, 'In a list')] }] },
      { type: 'callout', attrs: { kind: 'note' }, content: [heading(2, 'In a callout')] },
    );
    expect(extractOutline(d).map(i => i.text)).toEqual(['Quoted', 'In a list', 'In a callout']);
  });

  it('has nothing for a note with no headings, and keeps inline formatting as plain text', () => {
    expect(extractOutline(doc(para('just text')))).toEqual([]);
    const marked = documentSchema().nodeFromJSON({
      type: 'doc',
      content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Bold ', marks: [{ type: 'bold' }] }, { type: 'text', text: 'and plain' }] }],
    });
    expect(extractOutline(marked).map(i => i.text)).toEqual(['Bold and plain']);
  });
});

describe('currentHeading', () => {
  const items: OutlineItem[] = [{ level: 1, text: 'A', pos: 0 }, { level: 2, text: 'B', pos: 20 }, { level: 2, text: 'C', pos: 50 }];
  it('is the last heading at or before the position, and none before the first', () => {
    expect(currentHeading(items, 0)).toBe(0);
    expect(currentHeading(items, 19)).toBe(0);
    expect(currentHeading(items, 20)).toBe(1);
    expect(currentHeading(items, 999)).toBe(2);
    expect(currentHeading([{ level: 1, text: 'X', pos: 10 }], 3)).toBe(-1);
    expect(currentHeading([], 5)).toBe(-1);
  });
});

describe('indentLevels', () => {
  const at = (...levels: number[]): OutlineItem[] => levels.map((level, i) => ({ level, text: String(i), pos: i }));
  it('indents by depth, relative to the shallowest heading used', () => {
    expect(indentLevels(at(1, 2, 3, 2, 1))).toEqual([0, 1, 2, 1, 0]);
    expect(indentLevels(at(2, 3, 2))).toEqual([0, 1, 0]); // a note that starts at ## is not pushed in
  });
  it('a jump of levels is one step of indent, not several', () => {
    expect(indentLevels(at(1, 4, 5, 2))).toEqual([0, 1, 2, 1]);
  });
  it('is empty for no headings', () => {
    expect(indentLevels([])).toEqual([]);
  });
});
