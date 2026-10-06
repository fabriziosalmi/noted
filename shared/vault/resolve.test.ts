import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { buildLinkResolver, normalizeTarget } from './resolve';

const names = ['Home.md', 'Work/Plan.md', 'Work/Notes.md', 'Life/Plan.md', 'Life/Garden.md', 'Archive/Plan.md'];

describe('link resolution (Obsidian rules)', () => {
  const r = buildLinkResolver(names);

  it('ignores case and a trailing .md', () => {
    expect(r.resolve('home')).toBe('Home.md');
    expect(r.resolve('HOME.MD')).toBe('Home.md');
    expect(r.resolve('  Home  ')).toBe('Home.md');
    expect(r.resolve('work/NOTES')).toBe('Work/Notes.md');
  });

  it('finds a note by its name alone, wherever it is', () => {
    expect(r.resolve('Garden')).toBe('Life/Garden.md');
    expect(r.resolve('notes')).toBe('Work/Notes.md');
  });

  it('a link with a path means that note, even when other notes share the name', () => {
    expect(r.resolve('Work/Plan')).toBe('Work/Plan.md');
    expect(r.resolve('life/plan')).toBe('Life/Plan.md');
  });

  it('a name that fits several notes: the one next to the linking note, else the shortest, else alphabetical', () => {
    expect(r.resolve('Plan', 'Life/Garden.md')).toBe('Life/Plan.md');
    expect(r.resolve('Plan', 'Work/Notes.md')).toBe('Work/Plan.md');
    expect(r.resolve('Plan', 'Home.md')).toBe('Life/Plan.md'); // same depth and length as Work/Plan: alphabetical; Archive/ is longer
    expect(r.resolve('Plan')).toBe('Life/Plan.md');
    expect(buildLinkResolver(['A/B/Plan.md', 'Plan2.md', 'C/Plan.md']).resolve('Plan')).toBe('C/Plan.md');
  });

  it('a note at the root named like the link beats folders', () => {
    const rr = buildLinkResolver(['Plan.md', 'Work/Plan.md']);
    expect(rr.resolve('Plan', 'Work/Other.md')).toBe('Plan.md');
    expect(rr.resolve('Work/Plan')).toBe('Work/Plan.md');
  });

  it('a path matches the end of a deeper path', () => {
    const rr = buildLinkResolver(['Projects/Work/Plan.md', 'Other/Plan.md']);
    expect(rr.resolve('Work/Plan')).toBe('Projects/Work/Plan.md');
    expect(rr.resolve('Nope/Plan')).toBeNull();
    expect(rr.resolve('ork/Plan')).toBeNull(); // whole segments only
  });

  it('answers null for what does not exist or is empty', () => {
    expect(r.resolve('Missing')).toBeNull();
    expect(r.resolve('')).toBeNull();
    expect(r.resolve('   ')).toBeNull();
    expect(r.resolve('/')).toBeNull();
  });

  it('does not depend on the order the files were listed in', () => {
    fc.assert(fc.property(fc.shuffledSubarray(names, { minLength: names.length }), fc.constantFrom('Plan', 'plan', 'Work/Plan', 'Garden', 'Home'), fc.constantFrom(undefined, 'Life/Garden.md', 'Home.md'), (shuffled, target, from) => {
      expect(buildLinkResolver(shuffled).resolve(target, from)).toBe(r.resolve(target, from));
    }));
  });

  it('every note resolves from its own path, with or without the extension, in any case', () => {
    fc.assert(fc.property(fc.constantFrom(...names), fc.boolean(), fc.boolean(), (name, keepExt, upper) => {
      const t = keepExt ? name : name.replace(/\.md$/, '');
      expect(r.resolve(upper ? t.toUpperCase() : t)).toBe(name);
    }));
  });

  it('normalizes the way the resolver compares', () => {
    expect(normalizeTarget(' /Work/Plan.MD/ ')).toBe('work/plan');
  });
});

describe('aliases', () => {
  const aliases = { 'Home.md': ['Start', 'Landing Page'], 'Work/Plan.md': ['Roadmap'], 'Life/Plan.md': ['Roadmap', 'Garden plan'], 'Gone.md': ['Ghost'] };
  const r = buildLinkResolver(names, aliases);

  it('a link that names no note finds the note with that alias, in any case', () => {
    expect(r.resolve('Start')).toBe('Home.md');
    expect(r.resolve('LANDING page')).toBe('Home.md');
    expect(r.resolve('garden plan')).toBe('Life/Plan.md');
    expect(r.resolve('Start.md')).toBe('Home.md');
  });

  it('a name or path always wins over an alias', () => {
    const withClash = buildLinkResolver(names, { 'Life/Garden.md': ['Home'] });
    expect(withClash.resolve('Home')).toBe('Home.md');
    expect(withClash.resolve('home')).toBe('Home.md');
  });

  it('an alias two notes share is settled like a name two notes share: the neighbour, then the shortest path', () => {
    expect(r.resolve('Roadmap', 'Work/Notes.md')).toBe('Work/Plan.md');
    expect(r.resolve('Roadmap', 'Life/Garden.md')).toBe('Life/Plan.md');
    expect(r.resolve('Roadmap', 'Home.md')).toBe('Life/Plan.md'); // same depth and length: alphabetical
  });

  it('an alias of a note that does not exist is nothing', () => {
    expect(r.resolve('Ghost')).toBeNull();
  });

  it('does not depend on the order the notes were listed in, nor on the order of the aliases', () => {
    const shuffled = buildLinkResolver([...names].reverse(), Object.fromEntries(Object.entries(aliases).reverse()));
    for (const t of ['Start', 'Roadmap', 'Garden plan', 'Plan', 'Missing']) expect(shuffled.resolve(t, 'Home.md')).toBe(r.resolve(t, 'Home.md'));
  });
});

