import { describe, it, expect } from 'vitest';
import { seedFor, seedBlock } from './seed';
import { blankView } from './model';
import { fieldsFromFrontmatter } from '../vault/fields';
import type { FieldType } from './schema';

const types: Record<string, FieldType> = { votes: 'number', status: 'select', tags: 'list', done: 'checkbox' };
const typeOf = (f: string): FieldType => types[f] ?? 'text';

describe('seedFor', () => {
  it('a plain view seeds nothing, at the top of the vault', () => {
    expect(seedFor(blankView('v', 'V'), typeOf)).toEqual({ folder: '', fields: {} });
  });

  it('a folder view puts the note in the folder, a tag view gives it the tag', () => {
    expect(seedFor(blankView('v', 'V', { source: { kind: 'folder', folder: 'Work/Plans' } }), typeOf).folder).toBe('Work/Plans');
    expect(seedFor(blankView('v', 'V', { source: { kind: 'tag', tag: '#idea' } }), typeOf)).toEqual({ folder: '', tag: '#idea', fields: {} });
  });

  it('"is" filters seed their value, so the new note passes them: numbers as numbers, lists as lists, checked as true', () => {
    const view = blankView('v', 'V', { filters: [
      { field: 'status', op: 'equals', value: 'open' }, { field: 'votes', op: 'equals', value: '5' }, { field: 'tags', op: 'has', value: 'q4' },
      { field: 'done', op: 'is-true' }, { field: 'x', op: 'contains', value: 'no' }, { field: 'y', op: 'equals' }, { field: '$name', op: 'equals', value: 'z' },
      { field: 'w', op: 'not-equals', value: 'q' },
    ] });
    expect(seedFor(view, typeOf).fields).toEqual({ status: 'open', votes: 5, tags: ['q4'], done: true });
  });

  it('a board column gives the group field its value (typed), and "no value" removes what a filter seeded', () => {
    const view = blankView('v', 'V', { layout: 'board', groupBy: 'status', filters: [{ field: 'status', op: 'equals', value: 'open' }, { field: 'votes', op: 'equals', value: 2 }] });
    expect(seedFor(view, typeOf, 'done').fields).toEqual({ status: 'done', votes: 2 });
    expect(seedFor(view, typeOf, null).fields).toEqual({ votes: 2 });
    expect(seedFor(view, typeOf).fields).toEqual({ status: 'open', votes: 2 });
    expect(seedFor(blankView('v', 'V', { layout: 'board', groupBy: 'votes' }), typeOf, '7').fields).toEqual({ votes: 7 });
  });
});

describe('seedBlock', () => {
  it('is null for nothing, and otherwise a block the fields read back from, without a final newline', () => {
    expect(seedBlock({})).toBeNull();
    const block = seedBlock({ status: 'open', votes: 3, tags: ['a', 'b'], done: true, note: 'x: y' });
    expect(block).not.toBeNull();
    expect(block!.endsWith('\n')).toBe(false);
    expect(fieldsFromFrontmatter(block)).toEqual({ status: 'open', votes: 3, tags: ['a', 'b'], done: true, note: 'x: y' });
  });
});
