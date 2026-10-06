// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { aliasesFromFrontmatter, MAX_ALIASES } from './aliases';

const fm = (yaml: string): string => `---\n${yaml}\n---\n`;

describe('aliasesFromFrontmatter', () => {
  it('reads the forms Obsidian writes', () => {
    expect(aliasesFromFrontmatter(fm('aliases: [Start, Home Page]'))).toEqual(['Start', 'Home Page']);
    expect(aliasesFromFrontmatter(fm('aliases:\n  - Start\n  - "Home: the page"\n  - \'it\'\'s\''))).toEqual(['Start', 'Home: the page', "it's"]);
    expect(aliasesFromFrontmatter(fm('alias: Start'))).toEqual(['Start']);
    expect(aliasesFromFrontmatter(fm('aliases: Start, Home'))).toEqual(['Start', 'Home']);
    expect(aliasesFromFrontmatter(fm('title: x\naliases: [a]\ntags: [t]'))).toEqual(['a']);
  });

  it('is tolerant: numbers are names, junk is skipped, duplicates (any case) are one', () => {
    expect(aliasesFromFrontmatter(fm('aliases: [2026, a, A, "", null, [nested], {k: v}, true]'))).toEqual(['2026', 'a']);
    expect(aliasesFromFrontmatter(fm('aliases: [x]\nalias: X'))).toEqual(['x']);
  });

  it('has none when there is none: no frontmatter, no such key, an empty value, broken YAML, not a mapping', () => {
    expect(aliasesFromFrontmatter(null)).toEqual([]);
    expect(aliasesFromFrontmatter('')).toEqual([]);
    expect(aliasesFromFrontmatter(fm('title: no aliases here'))).toEqual([]);
    expect(aliasesFromFrontmatter(fm('aliases:'))).toEqual([]);
    expect(aliasesFromFrontmatter(fm('aliases: [unclosed'))).toEqual([]);
    expect(aliasesFromFrontmatter(fm('- just\n- a list'))).toEqual([]);
  });

  it('keeps the number and the length of aliases bounded', () => {
    const many = Array.from({ length: MAX_ALIASES + 20 }, (_, i) => `a${i}`).join(', ');
    expect(aliasesFromFrontmatter(fm(`aliases: [${many}]`))).toHaveLength(MAX_ALIASES);
    expect(aliasesFromFrontmatter(fm(`aliases: [${'x'.repeat(201)}, ok]`))).toEqual(['ok']);
  });

  it('does not read a key that only contains the word (or an alias inside a value)', () => {
    expect(aliasesFromFrontmatter(fm('aliasing: [a]\ntitle: "aliases: [b]"'))).toEqual([]);
  });

  it('accepts CRLF and a block without the closing newline', () => {
    expect(aliasesFromFrontmatter('---\r\naliases: [a]\r\n---')).toEqual(['a']);
  });
});
