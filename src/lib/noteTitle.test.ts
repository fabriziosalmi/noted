import { describe, it, expect } from 'vitest';
import { deriveTitle, slugifyTitle } from './noteTitle';

describe('deriveTitle', () => {
  it('takes the first heading text', () => {
    expect(deriveTitle('<h1>Aurora</h1><p>body</p>')).toBe('Aurora');
    expect(deriveTitle('<h2>Sub heading</h2>')).toBe('Sub heading');
  });

  it('strips nested inline tags and decodes entities', () => {
    expect(deriveTitle('<h1>My <strong>Bold</strong> &amp; Title</h1>')).toBe('My Bold & Title');
  });

  it('falls back to the first non-empty text line when there is no heading', () => {
    expect(deriveTitle('<p>First line</p><p>Second</p>')).toBe('First line');
    expect(deriveTitle('<p></p><p>  actual  </p>')).toBe('actual');
  });

  it('returns empty for empty or blank content', () => {
    expect(deriveTitle('')).toBe('');
    expect(deriveTitle('<h1></h1><p></p>')).toBe('');
  });
});

describe('slugifyTitle', () => {
  it('strips reserved filesystem characters', () => {
    expect(slugifyTitle('a/b:c*d?e"f<g>h|i;j`k$l')).toBe('abcdefghijkl');
  });

  it('collapses whitespace and trims', () => {
    expect(slugifyTitle('  Hello   World  ')).toBe('Hello World');
    expect(slugifyTitle('Project: Aurora / Q3 *draft*')).toBe('Project Aurora Q3 draft');
  });

  it('keeps accented and non-latin characters (a notes app is multilingual)', () => {
    expect(slugifyTitle('Caffè & Progetti')).toBe('Caffè & Progetti');
  });

  it('caps length at 120 characters', () => {
    expect(slugifyTitle('a'.repeat(200)).length).toBe(120);
  });

  it('returns empty when nothing usable remains', () => {
    expect(slugifyTitle('')).toBe('');
    expect(slugifyTitle('   ')).toBe('');
    expect(slugifyTitle('/:*?"<>|')).toBe('');
  });
});
