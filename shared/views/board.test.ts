import { describe, it, expect } from 'vitest';
import { buildBoard, groupableFields, groupsOf, valueForColumn, canMoveCards, withColumn, movedColumn } from './board';
import type { ViewRow } from './query';
import type { FieldValue } from '../vault/fields';

const row = (name: string, fields: Record<string, FieldValue>): ViewRow => ({ name, title: name.replace('.md', ''), folder: '', fields, modified: 1 });
const names = (rows: ViewRow[]) => rows.map(r => r.name);
const shape = (cols: ReturnType<typeof buildBoard>) => cols.map(c => [c.value, names(c.rows), c.pinned]);

describe('groupsOf', () => {
  it('one column for a value, none for no value, one per item of a list', () => {
    expect(groupsOf('open')).toEqual(['open']);
    expect(groupsOf(3)).toEqual(['3']);
    expect(groupsOf(false)).toEqual(['false']);
    for (const v of [undefined, null, '', []] as FieldValue[]) expect(groupsOf(v)).toEqual([]);
    expect(groupsOf(['a', 'b', 'a', null, ''])).toEqual(['a', 'b']);
  });
});

describe('buildBoard', () => {
  const rows = [
    row('a.md', { status: 'open' }), row('b.md', { status: 'done' }), row('c.md', { status: 'open' }),
    row('d.md', {}), row('e.md', { status: 'review' }), row('f.md', { status: '' }), row('g.md', { status: 'open' }),
  ];

  it('is empty until a field is chosen', () => {
    expect(buildBoard(rows, {})).toEqual([]);
  });

  it('a column for each value found, the most used first, then the notes with no value; cards keep the view\'s order', () => {
    expect(shape(buildBoard(rows, { groupBy: 'status' }))).toEqual([
      ['open', ['a.md', 'c.md', 'g.md'], false],
      ['done', ['b.md'], false],
      ['review', ['e.md'], false],
      [null, ['d.md', 'f.md'], false],
    ]);
  });

  it('the columns the view lists come first, in its order, even when empty; the others follow', () => {
    expect(shape(buildBoard(rows, { groupBy: 'status', boardColumns: ['todo', 'done', 'open'] }))).toEqual([
      ['todo', [], true], ['done', ['b.md'], true], ['open', ['a.md', 'c.md', 'g.md'], true],
      ['review', ['e.md'], false], [null, ['d.md', 'f.md'], false],
    ]);
  });

  it('no column for "no value" when every note has one', () => {
    expect(buildBoard([row('a.md', { s: 'x' })], { groupBy: 's' }).map(c => c.value)).toEqual(['x']);
  });

  it('a note with a list appears under each of its values', () => {
    const board = buildBoard([row('a.md', { tags: ['x', 'y'] }), row('b.md', { tags: ['y'] })], { groupBy: 'tags' });
    expect(shape(board)).toEqual([['y', ['a.md', 'b.md'], false], ['x', ['a.md'], false]]);
  });

  it('ties between columns are broken by name, so the board does not shuffle', () => {
    const board = buildBoard([row('a.md', { s: 'b' }), row('b.md', { s: 'a' })], { groupBy: 's' });
    expect(board.map(c => c.value)).toEqual(['a', 'b']);
  });
});

describe('moving cards', () => {
  it('the value a column stands for, in the type of the field; no value removes the property', () => {
    expect(valueForColumn('open', 'select')).toBe('open');
    expect(valueForColumn('3', 'number')).toBe(3);
    expect(valueForColumn('three', 'number')).toBe('three');
    expect(valueForColumn('true', 'checkbox')).toBe(true);
    expect(valueForColumn('false', 'checkbox')).toBe(false);
    expect(valueForColumn(null, 'select')).toBeUndefined();
  });

  it('cards cannot be moved between the columns of a list field', () => {
    expect(canMoveCards('select')).toBe(true);
    expect(canMoveCards('text')).toBe(true);
    expect(canMoveCards('list')).toBe(false);
  });
});

describe('groupableFields', () => {
  it('leaves out lists, which put a note in several columns', () => {
    expect(groupableFields([{ name: 'status', type: 'select' }, { name: 'tags', type: 'list' }, { name: 'votes', type: 'number' }])).toEqual(['status', 'votes']);
  });
});

describe('the list of columns', () => {
  it('adds a new one at the end, once, and not past the limit', () => {
    expect(withColumn(undefined, ' todo ', 3)).toEqual(['todo']);
    expect(withColumn(['a'], 'a', 3)).toEqual(['a']);
    expect(withColumn(['a'], '  ', 3)).toEqual(['a']);
    expect(withColumn(['a', 'b', 'c'], 'd', 3)).toEqual(['a', 'b', 'c']);
  });

  it('moves one a place left or right, and stays put at the ends', () => {
    expect(movedColumn(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(movedColumn(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
    expect(movedColumn(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
    expect(movedColumn(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
    expect(movedColumn(['a'], 5, 1)).toEqual(['a']);
  });
});
