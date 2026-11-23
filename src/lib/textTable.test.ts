// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { detectDelimiter, parseTextTable, toMarkdownTable, toDelimitedText, tableDataToHtml } from './textTable';

describe('detectDelimiter', () => {
  it('picks the most frequent delimiter', () => {
    expect(detectDelimiter('a\tb\tc\nd\te\tf')).toBe('\t');
    expect(detectDelimiter('a;b;c,d')).toBe(';');
    expect(detectDelimiter('| a | b |')).toBe('|');
    expect(detectDelimiter('a,b,c')).toBe(',');
  });

  it('falls back to comma when nothing matches', () => {
    expect(detectDelimiter('')).toBe(',');
    expect(detectDelimiter('plain text')).toBe(',');
  });
});

describe('parseTextTable', () => {
  it('parses with a detected delimiter and trims whitespace', () => {
    expect(parseTextTable('a ,  b\n c, d ')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('honors an explicit delimiter', () => {
    expect(parseTextTable('a,b;c\nd,e;f', ';')).toEqual([['a,b', 'c'], ['d,e', 'f']]);
  });

  it('strips outer pipes', () => {
    expect(parseTextTable('| a | b |\n| c | d |')).toEqual([['a', 'b'], ['c', 'd']]);
    expect(parseTextTable('a | b\nc | d', '|')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('pads ragged rows and skips blank lines', () => {
    expect(parseTextTable('a,b,c\n\nd\r\ne,f')).toEqual([['a', 'b', 'c'], ['d', '', ''], ['e', 'f', '']]);
  });

  it('handles empty and single-column input', () => {
    expect(parseTextTable('')).toEqual([]);
    expect(parseTextTable('  \n ')).toEqual([]);
    expect(parseTextTable('a\nb')).toEqual([['a'], ['b']]);
  });
});

describe('toMarkdownTable', () => {
  it('renders a header, separator, and body rows', () => {
    expect(toMarkdownTable([['a', 'b'], ['c', 'd']])).toBe('| a | b |\n| --- | --- |\n| c | d |');
  });

  it('escapes pipes in cells', () => {
    expect(toMarkdownTable([['a|b'], ['c']])).toBe('| a\\|b |\n| --- |\n| c |');
  });

  it('pads ragged rows', () => {
    expect(toMarkdownTable([['a', 'b'], ['c']])).toBe('| a | b |\n| --- | --- |\n| c |  |');
  });

  it('returns an empty string for no rows', () => {
    expect(toMarkdownTable([])).toBe('');
  });
});

describe('toDelimitedText', () => {
  it('defaults to tabs', () => {
    expect(toDelimitedText([['a', 'b'], ['c', 'd']])).toBe('a\tb\nc\td');
  });

  it('uses an explicit delimiter', () => {
    expect(toDelimitedText([['a', 'b'], ['c', 'd']], ',')).toBe('a,b\nc,d');
    expect(toDelimitedText([])).toBe('');
  });
});

describe('tableDataToHtml', () => {
  it('renders thead/tbody and escapes HTML', () => {
    expect(tableDataToHtml([['a<b', 'c'], ['1&2', '3']])).toBe(
      '<table><thead><tr><th>a&lt;b</th><th>c</th></tr></thead><tbody><tr><td>1&amp;2</td><td>3</td></tr></tbody></table>'
    );
    expect(tableDataToHtml([])).toBe('');
  });
});
