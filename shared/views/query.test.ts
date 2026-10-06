import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { runView, cycleSort, matchesFilter, sourceNotes, sortRows, NAME_FIELD, MODIFIED_FIELD, type ViewContext, type ViewRow } from './query';
import { blankView, type View, type ViewFilter } from './model';
import type { FieldValue } from '../vault/fields';

const note = (name: string, mtimeMs = 1) => ({ name, mtimeMs });
const ctx = (fm: Record<string, Record<string, FieldValue>>, tags: Record<string, string[]> = {}, names?: string[]): ViewContext => ({
  notes: (names ?? Object.keys(fm)).map(n => note(n)), frontmatter: fm, tags,
});
const row = (fields: Record<string, FieldValue>, name = 'Work/Plan.md'): ViewRow => ({
  name, title: name.replace(/\.md$/, '').split('/').pop()!, folder: '', fields, modified: 5,
});
const f = (field: string, op: ViewFilter['op'], value?: ViewFilter['value']): ViewFilter => ({ field, op, ...(value === undefined ? {} : { value }) });
const pass = (fields: Record<string, FieldValue>, filter: ViewFilter): boolean => matchesFilter(row(fields), filter);
const names = (rows: ViewRow[]): string[] => rows.map(r => r.name);

describe('the source', () => {
  const notes = ['A.md', 'Work/B.md', 'Work/Deep/C.md', 'Workshop/D.md', 'work/E.md'];
  const c = ctx({}, { '#idea': ['A.md', 'Work/B.md'] }, notes);
  it('all notes, a folder at any depth (not a folder that merely starts alike), or a tag', () => {
    expect(sourceNotes(blankView('v', 'V'), c).map(n => n.name)).toEqual(notes);
    expect(sourceNotes(blankView('v', 'V', { source: { kind: 'folder', folder: 'Work' } }), c).map(n => n.name)).toEqual(['Work/B.md', 'Work/Deep/C.md', 'work/E.md']);
    expect(sourceNotes(blankView('v', 'V', { source: { kind: 'tag', tag: '#IDEA' } }), c).map(n => n.name)).toEqual(['A.md', 'Work/B.md']);
    expect(sourceNotes(blankView('v', 'V', { source: { kind: 'tag', tag: '#none' } }), c)).toEqual([]);
  });
});

describe('filters', () => {
  it('equals ignores case and compares numbers as numbers; not-equals is its opposite, a missing field included', () => {
    expect(pass({ status: 'Open' }, f('status', 'equals', 'open'))).toBe(true);
    expect(pass({ votes: 3 }, f('votes', 'equals', '3'))).toBe(true);
    expect(pass({ votes: 3 }, f('votes', 'equals', 3.0))).toBe(true);
    expect(pass({ votes: 3 }, f('votes', 'equals', 4))).toBe(false);
    expect(pass({}, f('status', 'equals', 'open'))).toBe(false);
    expect(pass({ status: 'done' }, f('status', 'not-equals', 'open'))).toBe(true);
    expect(pass({}, f('status', 'not-equals', 'open'))).toBe(true);
    expect(pass({ status: 'open' }, f('status', 'not-equals', 'OPEN'))).toBe(false);
  });

  it('contains looks inside text, and inside each item of a list', () => {
    expect(pass({ t: 'Quarterly Plan' }, f('t', 'contains', 'plan'))).toBe(true);
    expect(pass({ tags: ['alpha', 'beta'] }, f('tags', 'contains', 'bet'))).toBe(true);
    expect(pass({ t: 'x' }, f('t', 'not-contains', 'y'))).toBe(true);
    expect(pass({}, f('t', 'contains', 'y'))).toBe(false);
  });

  it('has / not-has test list membership, and a single value is a list of one', () => {
    expect(pass({ tags: ['a', 'B'] }, f('tags', 'has', 'b'))).toBe(true);
    expect(pass({ tags: ['a'] }, f('tags', 'has', 'b'))).toBe(false);
    expect(pass({ tags: 'a' }, f('tags', 'has', 'a'))).toBe(true);
    expect(pass({ tags: ['a'] }, f('tags', 'not-has', 'b'))).toBe(true);
    expect(pass({}, f('tags', 'not-has', 'b'))).toBe(true);
  });

  it('is-empty / not-empty: missing, null, empty text and empty list are all empty', () => {
    for (const value of [null, '', []] as FieldValue[]) {
      expect(pass({ x: value }, f('x', 'is-empty'))).toBe(true);
      expect(pass({ x: value }, f('x', 'not-empty'))).toBe(false);
    }
    expect(pass({}, f('x', 'is-empty'))).toBe(true);
    expect(pass({ x: 0 }, f('x', 'not-empty'))).toBe(true);
    expect(pass({ x: false }, f('x', 'not-empty'))).toBe(true);
  });

  it('numbers: gt gte lt lte, only on values that are numbers', () => {
    expect(pass({ n: 5 }, f('n', 'gt', 4))).toBe(true);
    expect(pass({ n: 5 }, f('n', 'gt', 5))).toBe(false);
    expect(pass({ n: 5 }, f('n', 'gte', 5))).toBe(true);
    expect(pass({ n: 5 }, f('n', 'lt', '10'))).toBe(true);
    expect(pass({ n: 5 }, f('n', 'lte', 4))).toBe(false);
    expect(pass({ n: 'many' }, f('n', 'gt', 1))).toBe(false);
    expect(pass({}, f('n', 'lt', 1))).toBe(false);
    expect(pass({ n: [5] }, f('n', 'gt', 1))).toBe(false);
  });

  it('dates: before / after compare the day, and the time only when asked with one', () => {
    expect(pass({ due: '2026-10-05' }, f('due', 'before', '2026-10-06'))).toBe(true);
    expect(pass({ due: '2026-10-06' }, f('due', 'before', '2026-10-06'))).toBe(false);
    expect(pass({ due: '2026-10-06T23:00:00Z' }, f('due', 'before', '2026-10-06'))).toBe(false);
    expect(pass({ due: '2026-10-07' }, f('due', 'after', '2026-10-06'))).toBe(true);
    expect(pass({ due: '2026-10-06T09:00' }, f('due', 'before', '2026-10-06T10:00'))).toBe(true);
    expect(pass({ due: 'soon' }, f('due', 'before', '2026-10-06'))).toBe(false);
    expect(pass({ due: '2026-10-05' }, f('due', 'before', 'not a date'))).toBe(false);
  });

  it('checkbox: is-true is true only for true, is-false for everything else (a note without the box included)', () => {
    expect(pass({ done: true }, f('done', 'is-true'))).toBe(true);
    expect(pass({ done: false }, f('done', 'is-true'))).toBe(false);
    expect(pass({}, f('done', 'is-true'))).toBe(false);
    expect(pass({}, f('done', 'is-false'))).toBe(true);
    expect(pass({ done: false }, f('done', 'is-false'))).toBe(true);
    expect(pass({ done: true }, f('done', 'is-false'))).toBe(false);
  });

  it('a filter with no operand yet lets everything pass, so a new filter does not empty the view', () => {
    expect(pass({ a: 1 }, f('a', 'equals'))).toBe(true);
    expect(pass({ a: 1 }, f('a', 'contains', ''))).toBe(true);
  });

  it('the note\'s own name and modified time can be filtered too', () => {
    expect(matchesFilter(row({}, 'Work/Quarterly plan.md'), f(NAME_FIELD, 'contains', 'plan'))).toBe(true);
    expect(matchesFilter(row({}), f(MODIFIED_FIELD, 'gt', 4))).toBe(true);
  });
});

describe('sorting', () => {
  const rows = (...fields: Record<string, FieldValue>[]) => fields.map((fl, i) => row(fl, `n${i}.md`));
  const order = (rs: ViewRow[], sort: { field: string; dir: 'asc' | 'desc' }[]) => names(sortRows(rs, sort));

  it('numbers by size (not as text), text without caring about case, numbers inside text as numbers', () => {
    expect(order(rows({ n: 10 }, { n: 9 }, { n: 100 }), [{ field: 'n', dir: 'asc' }])).toEqual(['n1.md', 'n0.md', 'n2.md']);
    expect(order(rows({ t: 'b' }, { t: 'A' }, { t: 'c' }), [{ field: 't', dir: 'asc' }])).toEqual(['n1.md', 'n0.md', 'n2.md']);
    expect(order(rows({ t: 'item 10' }, { t: 'item 9' }), [{ field: 't', dir: 'asc' }])).toEqual(['n1.md', 'n0.md']);
  });

  it('descending reverses the order, but a note with no value stays last either way', () => {
    const rs = rows({ n: 1 }, {}, { n: 3 }, { n: null });
    expect(order(rs, [{ field: 'n', dir: 'asc' }])).toEqual(['n0.md', 'n2.md', 'n1.md', 'n3.md']);
    expect(order(rs, [{ field: 'n', dir: 'desc' }])).toEqual(['n2.md', 'n0.md', 'n1.md', 'n3.md']);
  });

  it('several keys: the next decides a tie, and the note name settles what is left', () => {
    const rs = rows({ s: 'a', n: 2 }, { s: 'b', n: 1 }, { s: 'a', n: 1 }, { s: 'a', n: 1 });
    expect(order(rs, [{ field: 's', dir: 'asc' }, { field: 'n', dir: 'desc' }])).toEqual(['n0.md', 'n2.md', 'n3.md', 'n1.md']);
    expect(order(rs, [])).toEqual(['n0.md', 'n1.md', 'n2.md', 'n3.md']);
  });

  it('is stable and total whatever the input order', () => {
    const value = fc.oneof(fc.constant(undefined), fc.integer({ min: 0, max: 3 }), fc.constantFrom('a', 'B', 'c10', 'c9'));
    fc.assert(fc.property(fc.array(fc.record({ k: value, j: value }), { maxLength: 10 }), fl => {
      const rs = fl.map((x, i) => row(Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined)) as Record<string, FieldValue>, `n${i}.md`));
      const sort = [{ field: 'k', dir: 'asc' as const }, { field: 'j', dir: 'desc' as const }];
      expect(names(sortRows([...rs].reverse(), sort))).toEqual(names(sortRows(rs, sort)));
    }), { numRuns: 300 });
  });
});

describe('runView', () => {
  it('draws from the source, keeps what passes every filter, and orders it', () => {
    const c = ctx({
      'Work/A.md': { status: 'open', due: '2026-10-09' },
      'Work/B.md': { status: 'done', due: '2026-10-01' },
      'Work/C.md': { status: 'open', due: '2026-10-02' },
      'Home/D.md': { status: 'open', due: '2026-10-03' },
      'Work/E.md': {},
    });
    const view: View = blankView('v', 'Open work', {
      source: { kind: 'folder', folder: 'Work' },
      filters: [f('status', 'equals', 'open')],
      sort: [{ field: 'due', dir: 'asc' }],
    });
    const rows = runView(view, c);
    expect(names(rows)).toEqual(['Work/C.md', 'Work/A.md']);
    expect(rows[0]).toMatchObject({ title: 'C', folder: 'Work', fields: { status: 'open', due: '2026-10-02' } });
  });

  it('a view with no filters or sort lists its notes by name', () => {
    expect(names(runView(blankView('v', 'V'), ctx({ 'b.md': {}, 'a.md': {} })))).toEqual(['a.md', 'b.md']);
  });
});

describe('cycleSort', () => {
  it('ascending, then descending, then none, keeping the other keys', () => {
    const other = { field: 'x', dir: 'desc' as const };
    expect(cycleSort([other], 'n')).toEqual([{ field: 'n', dir: 'asc' }, other]);
    expect(cycleSort([{ field: 'n', dir: 'asc' }, other], 'n')).toEqual([{ field: 'n', dir: 'desc' }, other]);
    expect(cycleSort([{ field: 'n', dir: 'desc' }, other], 'n')).toEqual([other]);
  });
});
