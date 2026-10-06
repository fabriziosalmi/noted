import { describe, it, expect } from 'vitest';
import {
  normalizeViews, normalizeView, serializeViews, blankView, MAX_VIEWS, MAX_FILTERS, MAX_NAME_CHARS, MAX_COLUMNS,
} from './model';

let n = 0;
const makeId = () => `gen-${++n}`;

describe('normalizeViews', () => {
  it('reads a well-formed view as it is', () => {
    const view = {
      id: 'v1', name: 'Open tasks', source: { kind: 'folder', folder: 'Projects' },
      filters: [{ field: 'status', op: 'equals', value: 'open' }, { field: 'due', op: 'is-empty' }],
      sort: [{ field: 'due', dir: 'desc' }], groupBy: 'status', columns: ['status', 'due'], layout: 'board',
    };
    expect(normalizeViews({ version: 1, views: [view] }, makeId)).toEqual([view]);
  });

  it('survives anything that is not a views file', () => {
    for (const raw of [null, undefined, 3, 'x', [], {}, { views: 'no' }, { views: [null, 1, 'x', []] }]) {
      expect(normalizeViews(raw, makeId)).toEqual([]);
    }
  });

  it('gives a view that lacks a usable id, or repeats one, a fresh id', () => {
    const views = normalizeViews({ views: [{ name: 'A' }, { id: 'same', name: 'B' }, { id: 'same', name: 'C' }, { id: 'bad id!', name: 'D' }] }, makeId);
    expect(views.map(v => v.name)).toEqual(['A', 'B', 'C', 'D']);
    expect(new Set(views.map(v => v.id)).size).toBe(4);
    expect(views[1].id).toBe('same');
    for (const v of views) expect(v.id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });

  it('falls back to the defaults for what is invalid, and drops what is unusable', () => {
    const [v] = normalizeViews({ views: [{
      id: 'a', name: '  Plan  ', layout: 'gantt', source: { kind: 'sql', q: 'x' },
      filters: [{ field: 'a', op: 'nope' }, { field: '', op: 'equals' }, 5, { field: 'ok', op: 'gt', value: { x: 1 } }, { field: 'n', op: 'gte', value: 3 }],
      sort: [{ field: 'a', dir: 'sideways' }, { dir: 'asc' }],
      columns: ['a', 'a', 7, 'b'], groupBy: 5, extra: 'dropped',
    }] }, makeId);
    expect(v).toEqual({
      id: 'a', name: 'Plan', layout: 'table', source: { kind: 'all' },
      filters: [{ field: 'ok', op: 'gt' }, { field: 'n', op: 'gte', value: 3 }],
      sort: [{ field: 'a', dir: 'asc' }], columns: ['a', 'b'],
    });
  });

  it('drops a view with no name, and a folder or tag source with nothing in it', () => {
    expect(normalizeView({ id: 'a', name: '   ' })).toBeNull();
    expect(normalizeView({ id: 'a', name: 'x'.repeat(MAX_NAME_CHARS + 1) })).toBeNull();
    expect(normalizeView({ name: 'A', source: { kind: 'folder', folder: '' } })?.source).toEqual({ kind: 'all' });
    expect(normalizeView({ name: 'A', source: { kind: 'folder', folder: '/Work/Plans/' } })?.source).toEqual({ kind: 'folder', folder: 'Work/Plans' });
    expect(normalizeView({ name: 'A', source: { kind: 'tag', tag: 'idea' } })?.source).toEqual({ kind: 'tag', tag: '#idea' });
  });

  it('is bounded', () => {
    const many = Array.from({ length: MAX_VIEWS + 50 }, (_, i) => ({ id: `v${i}`, name: `V${i}` }));
    expect(normalizeViews({ views: many }, makeId)).toHaveLength(MAX_VIEWS);
    const [v] = normalizeViews({ views: [{
      id: 'a', name: 'A',
      filters: Array.from({ length: MAX_FILTERS + 10 }, () => ({ field: 'f', op: 'equals', value: 1 })),
      columns: Array.from({ length: MAX_COLUMNS + 10 }, (_, i) => `c${i}`),
    }] }, makeId);
    expect(v.filters).toHaveLength(MAX_FILTERS);
    expect(v.columns).toHaveLength(MAX_COLUMNS);
  });
});

describe('serializeViews', () => {
  it('is stable text that reads back as the same views', () => {
    const views = [blankView('a', 'All'), blankView('b', 'Board', { layout: 'board', groupBy: 'status', source: { kind: 'tag', tag: '#x' } })];
    const text = serializeViews(views);
    expect(text.endsWith('\n')).toBe(true);
    expect(text).toBe(serializeViews(normalizeViews(JSON.parse(text), makeId)));
    expect(normalizeViews(JSON.parse(text), makeId)).toEqual(views);
  });
});
