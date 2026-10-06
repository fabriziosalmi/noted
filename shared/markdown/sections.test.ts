import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { sectionsOf, findSection, replaceSectionBody, appendToSectionBody, sectionBody } from './sections';

const NOTE = `---
title: Plan
---
# Plan

intro text

## Risks

risk one

### Detail

fine print

## Budget

money

\`\`\`
# not a heading
\`\`\`

## Risks

second risks
`;

const sec = (note: string, heading: string, occurrence?: number) => {
  const r = findSection(note, heading, occurrence);
  if (!r.ok) throw new Error(r.error);
  return r.section;
};

describe('sectionsOf', () => {
  it('finds the headings, with levels and the span of each: sub-sections belong to their parent', () => {
    const sections = sectionsOf(NOTE);
    expect(sections.map(s => [s.level, s.title])).toEqual([[1, 'Plan'], [2, 'Risks'], [3, 'Detail'], [2, 'Budget'], [2, 'Risks']]);
    const risks = sections[1];
    expect(NOTE.slice(risks.start, risks.end)).toBe('## Risks\n\nrisk one\n\n### Detail\n\nfine print\n\n');
    expect(NOTE.slice(sections[0].start, sections[0].end)).toBe(NOTE.slice(sections[0].start)); // the title runs to the end
    expect(sections[1].line).toBe(8);
    expect(NOTE.slice(risks.start, risks.ownEnd)).toBe('## Risks\n\nrisk one\n\n'); // its own text stops at the first sub-heading
  });

  it('ignores headings in the frontmatter and in fenced code, and a BOM before the block', () => {
    const md = '﻿---\n# comment in yaml\n---\n## Real\n\n```\n## fake\n```\n\n~~~\n# fake\n~~~\n';
    expect(sectionsOf(md).map(s => s.title)).toEqual(['Real']);
  });

  it('understands closing hashes, CRLF, and a heading on the last line with no newline', () => {
    const md = '## One ##\r\n\r\ntext\r\n## Two';
    expect(sectionsOf(md).map(s => s.title)).toEqual(['One', 'Two']);
    expect(md.slice(sectionsOf(md)[1].start)).toBe('## Two');
  });
});

describe('findSection', () => {
  it('matches the text in any case and spacing, ignoring emphasis; hashes pin the level', () => {
    expect(sec(NOTE, 'budget').title).toBe('Budget');
    expect(sec('## **Big**  idea\n', 'big idea').level).toBe(2);
    expect(findSection(NOTE, '### Budget').ok).toBe(false);
    expect(sec(NOTE, '### Detail').title).toBe('Detail');
  });

  it('refuses an ambiguous heading, listing where, unless told which', () => {
    const r = findSection(NOTE, 'Risks');
    expect(r).toEqual({ ok: false, error: expect.stringContaining('lines 8, 24') });
    expect(sectionBody(NOTE, sec(NOTE, 'Risks', 2)).trim()).toBe('second risks');
    expect(findSection(NOTE, 'Risks', 3)).toEqual({ ok: false, error: expect.stringContaining('not 3') });
  });

  it('says so when there is no such heading', () => {
    expect(findSection(NOTE, 'Nowhere')).toEqual({ ok: false, error: 'no heading "Nowhere" in this note' });
    expect(findSection(NOTE, '  ').ok).toBe(false);
  });
});

describe('editing one section', () => {
  it('replaces the body and nothing else', () => {
    const out = replaceSectionBody(NOTE, sec(NOTE, 'Budget'), 'new numbers\n');
    expect(out).toBe(NOTE.replace('money\n\n```\n# not a heading\n```\n', 'new numbers\n'));
  });

  it('by default only the section\'s own text changes: its sub-sections stay; with whole they go too', () => {
    const own = replaceSectionBody(NOTE, sec(NOTE, 'Risks', 1), 'all new');
    expect(own).toContain('## Risks\n\nall new\n\n### Detail\n\nfine print\n\n## Budget');
    const whole = replaceSectionBody(NOTE, sec(NOTE, 'Risks', 1), 'all new', true);
    expect(whole).toContain('## Risks\n\nall new\n\n## Budget');
    expect(whole).not.toContain('fine print');
    expect(whole.endsWith('second risks\n')).toBe(true);
  });

  it('the last section, and a section with no text yet, work; an empty replacement empties it', () => {
    expect(replaceSectionBody('# T\n\ntext\n', sec('# T\n\ntext\n', 'T'), 'new')).toBe('# T\n\nnew\n');
    expect(replaceSectionBody('# T\n## U\n', sec('# T\n## U\n', 'U'), 'x')).toBe('# T\n## U\n\nx\n');
    expect(replaceSectionBody('# T\n\ntext\n\n## U\n', sec('# T\n\ntext\n\n## U\n', 'T'), '')).toBe('# T\n\n## U\n');
    expect(replaceSectionBody('# T\n\ntext\n\n## U\n', sec('# T\n\ntext\n\n## U\n', 'T'), '', true)).toBe('# T\n');
  });

  it('appends after what the section has, one blank line between, before the next heading', () => {
    const out = appendToSectionBody(NOTE, sec(NOTE, 'Budget'), '- extra line');
    expect(out).toContain('money\n\n```\n# not a heading\n```\n\n- extra line\n\n## Risks');
    expect(appendToSectionBody('## A\n', sec('## A\n', 'A'), 'x')).toBe('## A\n\nx\n');
    expect(appendToSectionBody(NOTE, sec(NOTE, 'Budget'), '  \n')).toBe(NOTE);
    // into the own text of a section that has sub-sections: before the first of them; with whole, after the last
    expect(appendToSectionBody(NOTE, sec(NOTE, 'Risks', 1), 'late')).toContain('risk one\n\nlate\n\n### Detail');
    expect(appendToSectionBody(NOTE, sec(NOTE, 'Risks', 1), 'late', true)).toContain('fine print\n\nlate\n\n## Budget');
  });

  it('keeps CRLF', () => {
    const md = '## A\r\n\r\none\r\n\r\n## B\r\n\r\ntwo\r\n';
    expect(replaceSectionBody(md, sec(md, 'A'), 'new')).toBe('## A\r\n\r\nnew\r\n\r\n## B\r\n\r\ntwo\r\n');
  });

  it('property: replacing a section leaves every byte outside it exactly as it was', () => {
    const words = fc.constantFrom('alpha', 'beta', '- item', '> quote', 'x'.repeat(30), '');
    const block = fc.oneof(
      fc.tuple(fc.integer({ min: 1, max: 3 }), fc.constantFrom('A', 'B', 'C', 'Risks')).map(([n, t]) => `${'#'.repeat(n)} ${t}`),
      words,
    );
    fc.assert(fc.property(fc.array(block, { minLength: 1, maxLength: 14 }), fc.constantFrom('new body', 'two\n\nparas', ''), (blocks, content) => {
      const md = `${blocks.join('\n')}\n`;
      const sections = sectionsOf(md);
      if (sections.length === 0) return;
      const target = sections[Math.floor(sections.length / 2)];
      const out = replaceSectionBody(md, target, content);
      expect(out.startsWith(md.slice(0, target.start))).toBe(true);
      const tail = md.slice(target.ownEnd);
      expect(out.endsWith(tail)).toBe(true);
      const keptHeading = md.slice(target.start, target.bodyStart).replace(/\n?$/, '');
      expect(out.slice(target.start).startsWith(keptHeading)).toBe(true);
    }), { numRuns: 800 });
  });
});
