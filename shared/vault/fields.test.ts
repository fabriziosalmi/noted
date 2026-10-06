import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { fieldsFromFrontmatter, fieldsViaLibrary, MAX_FIELDS, MAX_FIELD_TEXT, MAX_LIST_ITEMS } from './fields';

const fm = (body: string): string => `---\n${body}\n---\n`;

describe('fieldsFromFrontmatter', () => {
  it('reads scalars with their YAML types, and a date as the text it was written as', () => {
    expect(fieldsFromFrontmatter(fm('title: Plan\nvotes: 3\nprice: 2.5\ndone: true\nwhen: 2026-10-06\nempty:\nquoted: "7"'))).toEqual({
      title: 'Plan', votes: 3, price: 2.5, done: true, when: '2026-10-06', empty: null, quoted: '7',
    });
  });

  it('reads lists of scalars, flow or block', () => {
    expect(fieldsFromFrontmatter(fm('tags: [a, b]\nowners:\n  - ann\n  - 2\nnone: []'))).toEqual({ tags: ['a', 'b'], owners: ['ann', 2], none: [] });
  });

  it('leaves out what cannot be a cell: mappings, and lists holding them', () => {
    expect(fieldsFromFrontmatter(fm('meta:\n  k: 1\nrows:\n  - a: 1\nnested: [[1, 2]]\nkept: yes please'))).toEqual({ kept: 'yes please' });
  });

  it('is empty for no block, bad YAML or a block that is not a mapping', () => {
    expect(fieldsFromFrontmatter(null)).toEqual({});
    expect(fieldsFromFrontmatter(fm('a: [unclosed'))).toEqual({});
    expect(fieldsFromFrontmatter(fm('- just\n- a list'))).toEqual({});
    expect(fieldsFromFrontmatter(fm(''))).toEqual({});
  });

  it('keeps the spelling of keys, and a comment is not a field', () => {
    expect(fieldsFromFrontmatter(fm('# note to self\nStatus: Open # inline\nsome key: x'))).toEqual({ Status: 'Open', 'some key': 'x' });
  });

  it('is bounded: fields, text and list length', () => {
    const many = Array.from({ length: MAX_FIELDS + 20 }, (_, i) => `k${i}: ${i}`).join('\n');
    expect(Object.keys(fieldsFromFrontmatter(fm(many)))).toHaveLength(MAX_FIELDS);
    const long = fieldsFromFrontmatter(fm(`t: ${'x'.repeat(MAX_FIELD_TEXT + 50)}`)).t as string;
    expect(long).toHaveLength(MAX_FIELD_TEXT);
    const list = fieldsFromFrontmatter(fm(`l: [${Array.from({ length: MAX_LIST_ITEMS + 10 }, (_, i) => i).join(', ')}]`)).l as number[];
    expect(list).toHaveLength(MAX_LIST_ITEMS);
  });

  it('never throws on a billion-laughs alias bomb', () => {
    const bomb = fm('a: &a [x, x, x, x, x, x, x, x, x]\nb: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a]\nc: &c [*b, *b, *b, *b, *b, *b, *b, *b, *b]\nd: [*c, *c, *c, *c, *c, *c, *c, *c, *c]');
    expect(() => fieldsFromFrontmatter(bomb)).not.toThrow();
  });
});

describe('the fast path agrees with the YAML library', () => {
  // Values chosen to sit on the edges of what is plain YAML: numbers, specials, colons, hashes, spaces, quotes.
  const word = fc.constantFrom('draft', 'open', 'Done', 'a b', 'x-y', '2026-10-06', '1.2.3', '12', '-3', '4.5', '1e3', '.5', '5.', '+7',
    'true', 'False', 'TRUE', 'null', 'Null', '~', '.inf', '-.INF', '.nan', '0x1F', '0o17', '1_000', 'yes', 'No', 'on', 'a: b', 'a #b', '#c',
    '"q"', "'s'", '[x]', '{y}', '- z', '? k', '& anchor', '* alias', '! tag', '| pipe', '> fold', '@at', '`tick`', '%pct', 'a,b', 'tab\tin', 'é', '');
  const key = fc.constantFrom('title', 'status', 'due', 'n', 'Done', 'a-b', 'a_b', 'x1', '1x', 'a b', 'a:b', 'yes', 'null', '');
  const value = fc.oneof(
    word,
    fc.array(word, { maxLength: 4 }).map(items => `[${items.join(', ')}]`),
    fc.array(word, { maxLength: 3 }).map(items => `[${items.join(',')}]`),
  );
  const block = fc.array(fc.tuple(key, value), { maxLength: 6 }).map(rows => `---\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}${rows.length ? '\n' : ''}---\n`);

  it('gives the same fields for any block, plain or not', () => {
    fc.assert(fc.property(block, b => {
      expect(fieldsFromFrontmatter(b)).toEqual(fieldsViaLibrary(b));
    }), { numRuns: Number(process.env.FC_RUNS ?? 3000) });
  }, 300_000);

  it('also with a value-less key, a duplicate key, trailing spaces and CRLF', () => {
    for (const b of ['---\nk:\n---\n', '---\nk: 1\nk: 2\n---\n', '---\nk: v  \n---\n', '---\r\nk: v\r\nn: 3\r\n---\r\n', '---\nk:\n  - a\n---\n', '---\nk:   \nj: 1\n---\n']) {
      expect(fieldsFromFrontmatter(b)).toEqual(fieldsViaLibrary(b));
    }
  });
});
