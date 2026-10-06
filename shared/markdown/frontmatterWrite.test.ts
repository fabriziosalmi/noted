import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { setFrontmatterField, setNoteProperty, readStoredFrontmatter } from './frontmatterWrite';
import { fieldsFromFrontmatter, type FieldValue } from '../vault/fields';

const fm = (body: string, eol = '\n'): string => `---${eol}${body.split('\n').join(eol)}${eol}---${eol}`;
const set = (block: string | null, key: string, value: FieldValue | undefined): string => {
  const r = setFrontmatterField(block, key, value);
  if (!r.ok) throw new Error(r.error);
  return r.block;
};

const DOC = fm(`# a comment on top
title: "Plan"   # trailing note
votes: 3
tags: [a, b]
owners:
  - ann   # first
  - bob
empty:
done: true

due: 2026-10-06
note: 'it''s here'`);

describe('changing a value touches only that value', () => {
  it('a number, a quoted text (the quotes stay), a plain text, a checkbox, a date', () => {
    expect(set(DOC, 'votes', 4)).toBe(DOC.replace('votes: 3', 'votes: 4'));
    expect(set(DOC, 'title', 'New plan')).toBe(DOC.replace('"Plan"', '"New plan"'));
    expect(set(DOC, 'note', 'plain now')).toBe(DOC.replace("'it''s here'", "'plain now'"));
    expect(set(DOC, 'done', false)).toBe(DOC.replace('done: true', 'done: false'));
    expect(set(DOC, 'due', '2026-11-30')).toBe(DOC.replace('2026-10-06', '2026-11-30'));
  });

  it('a quoted text with a quote in it is escaped for its style', () => {
    expect(set(DOC, 'title', 'say "hi"')).toBe(DOC.replace('"Plan"', '"say \\"hi\\""'));
    expect(set(DOC, 'note', "don't")).toBe(DOC.replace("'it''s here'", "'don''t'"));
  });

  it('text that YAML would read as something else is quoted, so it stays text', () => {
    for (const text of ['true', '12', 'null', '2026-10-06', 'a: b', '# not a comment', '- dash', '*star', '']) {
      const out = set(DOC, 'votes', text);
      expect(fieldsFromFrontmatter(out).votes).toBe(text);
    }
  });

  it('a flow list stays a flow list, a block list stays a block list (its other comments aside), an empty list is []', () => {
    expect(set(DOC, 'tags', ['a', 'b', 'c'])).toBe(DOC.replace('[a, b]', '[a, b, c]'));
    expect(set(DOC, 'tags', [])).toBe(DOC.replace('[a, b]', '[]'));
    expect(set(DOC, 'owners', ['ann', 'bob', 'cy'])).toBe(DOC.replace('- ann   # first\n  - bob', '- ann\n  - bob\n  - cy'));
    expect(set(DOC, 'owners', [])).toBe(DOC.replace('- ann   # first\n  - bob', '[]'));
  });

  it('a list item that needs quotes gets them', () => {
    expect(fieldsFromFrontmatter(set(DOC, 'tags', ['a, b', 'true', '3'])).tags).toEqual(['a, b', 'true', '3']);
  });

  it('a value given to an empty key goes after the colon; an empty key can be emptied again', () => {
    expect(set(DOC, 'empty', 'now set')).toBe(DOC.replace('empty:\n', 'empty: now set\n'));
    expect(set(DOC, 'empty', ['x', 'y'])).toBe(DOC.replace('empty:\n', 'empty: [x, y]\n'));
    expect(set(DOC, 'votes', null)).toBe(DOC.replace('votes: 3', 'votes:'));
  });

  it('a scalar becoming a list, and a list becoming a scalar', () => {
    expect(set(DOC, 'votes', [1, 2])).toBe(DOC.replace('votes: 3', 'votes: [1, 2]'));
    expect(set(DOC, 'votes', ['1', '2'])).toBe(DOC.replace('votes: 3', 'votes: ["1", "2"]')); // text that looks like numbers stays text
    expect(set(DOC, 'tags', 'single')).toBe(DOC.replace('[a, b]', 'single'));
    expect(set(DOC, 'owners', 'just me')).toBe(DOC.replace('- ann   # first\n  - bob', 'just me'));
  });

  it('is exactly the same bytes when the value is already what was asked', () => {
    const odd = fm('tags: [a,b]\nvotes:   3');
    expect(setFrontmatterField(odd, 'tags', ['a', 'b'])).toEqual({ ok: true, block: odd, changed: false });
    expect(setFrontmatterField(odd, 'votes', 3)).toEqual({ ok: true, block: odd, changed: false });
  });
});

describe('adding and removing keys', () => {
  it('a new key goes after the last one; a key with an odd name is quoted', () => {
    expect(set(DOC, 'status', 'open')).toBe(DOC.replace("note: 'it''s here'\n", "note: 'it''s here'\nstatus: open\n"));
    expect(set(fm('a: 1'), 'b', ['x'])).toBe(fm('a: 1\nb: [x]'));
    expect(fieldsFromFrontmatter(set(fm('a: 1'), 'my key: odd', 'v'))['my key: odd']).toBe('v');
  });

  it('a note with an empty block, or none, gets a block', () => {
    expect(set('---\n---\n', 'status', 'open')).toBe('---\nstatus: open\n---\n');
    expect(set(null, 'status', 'open')).toBe('---\nstatus: open\n---\n');
    expect(set(null, 'status', undefined)).toBe('');
  });

  it('removing cuts the line (a block list, all of it) and nothing else', () => {
    expect(set(DOC, 'votes', undefined)).toBe(DOC.replace('votes: 3\n', ''));
    expect(set(DOC, 'owners', undefined)).toBe(DOC.replace('owners:\n  - ann   # first\n  - bob\n', ''));
    expect(set(DOC, 'title', undefined)).toBe(DOC.replace('title: "Plan"   # trailing note\n', ''));
    expect(set(DOC, 'note', undefined)).toBe(DOC.replace("\nnote: 'it''s here'", ''));
    expect(set(DOC, 'absent', undefined)).toBe(DOC);
  });

  it('removing the only key leaves a valid empty block', () => {
    expect(set(fm('a: 1'), 'a', undefined)).toBe('---\n---\n');
    expect(fieldsFromFrontmatter(set(fm('a: 1'), 'a', undefined))).toEqual({});
  });
});

describe('line endings and fences', () => {
  it('CRLF stays CRLF, in what is added too', () => {
    const crlf = fm('a: 1\nb: [x]', '\r\n');
    expect(set(crlf, 'a', 2)).toBe(crlf.replace('a: 1', 'a: 2'));
    expect(set(crlf, 'c', 'new')).toBe(fm('a: 1\nb: [x]\nc: new', '\r\n'));
    expect(set(crlf, 'a', undefined)).toBe(fm('b: [x]', '\r\n'));
  });

  it('a block stored without a trailing newline (the HTML note comment form) keeps that', () => {
    const bare = '---\na: 1\n---';
    expect(set(bare, 'a', 2)).toBe('---\na: 2\n---');
    expect(set(bare, 'b', 'x')).toBe('---\na: 1\nb: x\n---');
  });
});

describe('what it refuses', () => {
  const refused = (block: string, key: string, value: FieldValue | undefined) => {
    const r = setFrontmatterField(block, key, value);
    expect(r.ok).toBe(false);
  };

  it('broken YAML, duplicate keys, and a block that is not a mapping', () => {
    refused(fm('a: [unclosed'), 'a', 1);
    refused(fm('a: 1\na: 2'), 'b', 1);
    refused(fm('- just\n- a list'), 'a', 1);
    refused('not a block', 'a', 1);
  });

  it('values it cannot edit faithfully: mappings, anchors, aliases, tags', () => {
    refused(fm('meta:\n  k: 1'), 'meta', 'x');
    refused(fm('a: &x 1\nb: *x'), 'a', 2);
    refused(fm('a: !!str 1'), 'a', 2);
    refused(fm('rows:\n  - a: 1'), 'rows', ['x']);
  });

  it('a name that cannot be a key', () => {
    refused(fm('a: 1'), '', 1);
    refused(fm('a: 1'), 'two\nlines', 1);
  });

  it('a mapping elsewhere is left untouched when another key is edited', () => {
    const doc = fm('meta:\n  k: 1\nvotes: 3');
    expect(set(doc, 'votes', 4)).toBe(fm('meta:\n  k: 1\nvotes: 4'));
  });
});

describe('properties of the writer', () => {
  const word = fc.constantFrom('open', 'done', 'a b', 'true', '12', 'x: y', '# c', '', 'it\'s', 'say "hi"', 'é', '-', '[x]', 'null', '2026-10-06', 'long text '.repeat(12).trim());
  const scalar = fc.oneof(word, fc.integer({ min: -9, max: 99 }), fc.boolean(), fc.constant(null));
  const value = fc.oneof(scalar, fc.array(fc.oneof(word, fc.integer({ min: 0, max: 9 })), { maxLength: 4 }));
  const key = fc.constantFrom('title', 'status', 'votes', 'tags', 'owners', 'empty', 'done', 'new', 'due');
  const doc = fc.constantFrom(DOC, fm('a: 1'), fm('title: x # c\nlist:\n  - 1\n  - 2'), '---\n---\n', fm('# only a comment'), fm('tags: [a,b]\r\nz: 2', '\r\n'));

  it('whatever it writes reads back as asked, with every other property unchanged', () => {
    fc.assert(fc.property(doc, key, fc.oneof(value, fc.constant(undefined)), (block, k, v) => {
      const r = setFrontmatterField(block, k, v as FieldValue | undefined);
      if (!r.ok) return; // refusing is always allowed; writing wrongly never is
      const before = fieldsFromFrontmatter(block);
      const after = fieldsFromFrontmatter(r.block);
      const expected = { ...before };
      if (v === undefined) delete expected[k]; else expected[k] = v as FieldValue;
      expect(after).toEqual(expected);
    }), { numRuns: Number(process.env.FC_RUNS ?? 1500) });
  });

  // The lines of DOC that belong to each key (by position in the block); every other line must survive untouched.
  const OWN: Record<string, number[]> = { title: [2], votes: [3], tags: [4], owners: [5, 6, 7], empty: [8], done: [9], due: [11], note: [12] };
  const lines = DOC.split('\n');

  it('every line that does not belong to the edited key is byte-for-byte what it was, and in the same order', () => {
    fc.assert(fc.property(fc.constantFrom(...Object.keys(OWN)), fc.oneof(value, fc.constant(undefined)), (k, v) => {
      const r = setFrontmatterField(DOC, k, v as FieldValue | undefined);
      expect(r.ok).toBe(true); // an ordinary document is never refused
      if (!r.ok) return;
      const now = r.block.split('\n');
      let at = 0;
      lines.forEach((line, i) => {
        if (OWN[k].includes(i)) return;
        const found = now.indexOf(line, at);
        expect(found, `line ${i} "${line}" of the original`).toBeGreaterThanOrEqual(0);
        at = found + 1;
      });
    }), { numRuns: Number(process.env.FC_RUNS ?? 800) });
  });
});

describe('a whole note', () => {
  const md = (text: string) => {
    const r = setNoteProperty(text, 'markdown', 'status', 'done');
    if (!r.ok) throw new Error(r.error);
    return r.content;
  };

  it('Markdown: only the block changes; the body is the same bytes', () => {
    const body = '\n# Title\n\nSome  text  with   odd spacing\r\nand [[links]].\n\n```\ncode\n```\n';
    expect(md(`---\nstatus: open\ntitle: T\n---\n${body}`)).toBe(`---\nstatus: done\ntitle: T\n---\n${body}`);
    expect(md(`---\ntitle: T\n---\n${body}`)).toBe(`---\ntitle: T\nstatus: done\n---\n${body}`);
  });

  it('Markdown: a note with no properties gets a block, a blank line before the text; a BOM is kept', () => {
    expect(md('# Title\n\ntext\n')).toBe('---\nstatus: done\n---\n\n# Title\n\ntext\n');
    expect(md('')).toBe('---\nstatus: done\n---\n');
    expect(md('\uFEFF# Title\n')).toBe('\uFEFF---\nstatus: done\n---\n\n# Title\n');
    expect(md('\uFEFF---\nstatus: open\n---\nbody')).toBe('\uFEFF---\nstatus: done\n---\nbody');
  });

  it('Markdown: nothing changes (not one byte) when the property already has the value', () => {
    const raw = '---\r\nstatus: done\r\n---\r\nbody';
    expect(setNoteProperty(raw, 'markdown', 'status', 'done')).toEqual({ ok: true, content: raw, changed: false });
  });

  it('Markdown: a dash line in the body is not a block, and broken YAML is refused whole', () => {
    expect(readStoredFrontmatter('text\n---\na: 1\n---\n', 'markdown')).toBeNull();
    const broken = '---\nstatus: [oops\n---\nbody';
    expect(setNoteProperty(broken, 'markdown', 'status', 'done').ok).toBe(false);
  });

  it('HTML: the comment is rewritten in place and the rest of the note is untouched', () => {
    const comment = (b: string) => `<!--noted-frontmatter:${encodeURIComponent(b)}-->`;
    const raw = `${comment('---\nstatus: open\n# keep me\n---')}\n<h1>T</h1><p>x &amp; y</p>`;
    const r = setNoteProperty(raw, 'html', 'status', 'done');
    expect(r).toEqual({ ok: true, content: `${comment('---\nstatus: done\n# keep me\n---')}\n<h1>T</h1><p>x &amp; y</p>`, changed: true });
    const fresh = setNoteProperty('<h1>T</h1>', 'html', 'status', 'done');
    expect(fresh).toEqual({ ok: true, content: `${comment('---\nstatus: done\n---')}\n<h1>T</h1>`, changed: true });
    expect(readStoredFrontmatter(fresh.ok ? fresh.content : '', 'html')).toBe('---\nstatus: done\n---');
  });
});
