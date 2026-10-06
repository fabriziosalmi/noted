import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { inferSchema, inferField, isIsoDate } from './schema';
import type { FieldValue } from '../vault/fields';

const notes = (...rows: Record<string, FieldValue>[]): Record<string, Record<string, FieldValue>> =>
  Object.fromEntries(rows.map((r, i) => [`n${i}.md`, r]));
const typeOf = (name: string, ...values: FieldValue[]) => inferField(name, values).type;

describe('field types', () => {
  it('checkbox, number, date, list', () => {
    expect(typeOf('done', true, false, true)).toBe('checkbox');
    expect(typeOf('votes', 1, 2.5, -3)).toBe('number');
    expect(typeOf('due', '2026-10-06', '2026-11-30T09:30:00Z', '2027-01-01 08:00')).toBe('date');
    expect(typeOf('tags', ['a'], ['b', 'c'], [])).toBe('list');
  });

  it('a few different words is a choice, many different ones is text', () => {
    expect(typeOf('status', 'draft', 'open', 'done')).toBe('select');
    expect(typeOf('title', ...Array.from({ length: 12 }, (_, i) => `Note number ${i}`))).toBe('text');
    // 12 different values, but most notes repeat them: a choice
    const repeated = Array.from({ length: 30 }, (_, i) => `team${i % 12}`);
    expect(typeOf('team', ...repeated)).toBe('select');
    // long prose is never a choice
    expect(typeOf('summary', 'x'.repeat(100), 'y'.repeat(100))).toBe('text');
  });

  it('what is only a date in shape is checked: month and day must exist', () => {
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2028-02-29')).toBe(true);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('2026-10-00')).toBe(false);
    expect(isIsoDate('26-10-06')).toBe(false);
    expect(typeOf('d', '2026-02-30', '2026-03-01')).toBe('text');
  });

  it('empty values do not decide the type, and an all-empty field is text', () => {
    const info = inferField('votes', [1, null, '', 3]);
    expect(info).toMatchObject({ type: 'number', count: 2, present: 4, mixed: false });
    expect(inferField('x', [null, null])).toMatchObject({ type: 'text', count: 0, present: 2 });
  });

  it('notes that disagree make a text field, marked mixed', () => {
    expect(inferField('v', [1, 'many', 3])).toMatchObject({ type: 'text', mixed: true });
    expect(inferField('d', ['2026-10-06', 'next week'])).toMatchObject({ type: 'text', mixed: true });
    expect(inferField('b', [true, 'yes'])).toMatchObject({ type: 'text', mixed: true });
  });

  it('a list in some notes and a single word in others is a list, marked mixed', () => {
    expect(inferField('tags', [['a', 'b'], 'c', null])).toMatchObject({ type: 'list', mixed: true });
    expect(inferField('tags', [['a'], ['b'], null])).toMatchObject({ type: 'list', mixed: false });
  });
});

describe('options', () => {
  it('are the values in use, most used first, then alphabetical; each counted once per note', () => {
    const info = inferField('status', ['open', 'done', 'open', 'draft', 'done', 'open']);
    expect(info.options).toEqual([{ value: 'open', count: 3 }, { value: 'done', count: 2 }, { value: 'draft', count: 1 }]);
    const tags = inferField('tags', [['a', 'a', 'b'], ['b'], ['c']]);
    expect(tags.options).toEqual([{ value: 'b', count: 2 }, { value: 'a', count: 1 }, { value: 'c', count: 1 }]);
  });

  it('are not offered for number, date, checkbox or text fields, and are bounded for lists', () => {
    expect(inferField('n', [1, 2]).options).toEqual([]);
    expect(inferField('t', ['x'.repeat(50), 'y'.repeat(50), 'z'.repeat(50), 'a'.repeat(50), 'b'.repeat(50), 'c'.repeat(50)]).options).toEqual([]);
    const many = Array.from({ length: 300 }, (_, i) => [`t${i}`]);
    expect(inferField('tags', many).options).toHaveLength(100);
  });
});

describe('inferSchema', () => {
  it('lists every field of the vault, the ones most notes have first', () => {
    const schema = inferSchema(notes({ status: 'open', votes: 1 }, { status: 'done' }, { status: 'open', due: '2026-10-06' }));
    expect(schema.map(f => [f.name, f.type, f.count])).toEqual([['status', 'select', 3], ['due', 'date', 1], ['votes', 'number', 1]]);
  });

  it('is empty for no notes, and keeps the spelling of field names apart', () => {
    expect(inferSchema({})).toEqual([]);
    expect(inferSchema(notes({ Status: 'a' }, { status: 'b' })).map(f => f.name)).toEqual(['Status', 'status']);
  });

  it('gives the same answer whatever order the notes come in', () => {
    const value = fc.oneof(fc.constant(null), fc.boolean(), fc.integer({ min: -5, max: 5 }), fc.constantFrom('a', 'b', '2026-10-06', 'free text'), fc.array(fc.constantFrom('x', 'y', 'z'), { maxLength: 3 }));
    const row = fc.dictionary(fc.constantFrom('f1', 'f2', 'f3'), value);
    fc.assert(fc.property(fc.array(row, { maxLength: 12 }), rows => {
      const forward = inferSchema(notes(...rows));
      const backward = inferSchema(notes(...[...rows].reverse()));
      expect(backward).toEqual(forward);
    }), { numRuns: 500 });
  });
});
