import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LANGS } from './locales';

// Locale-parity gate. Every language is a JSON file in src/locales/. This guards
// the invariant that ships to users: every non-`en` locale defines every `en`
// key, with no stray keys, no empty strings, and the same {placeholders} (a
// translation that loses {name} would show the raw template). If it fails,
// complete the locale before merging.
const DIR = join(import.meta.dirname, '..', 'locales');
const read = (loc: string): Record<string, string> => JSON.parse(readFileSync(join(DIR, `${loc}.json`), 'utf8'));
const placeholders = (s: string): string => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

describe('i18n locale completeness', () => {
  const en = read('en');
  const enKeys = Object.keys(en);

  it('has exactly one file per language in LANGS', () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();
    expect(files).toEqual([...LANGS].sort());
  });

  it('parses a sane number of en keys (guards against parser drift)', () => {
    // Floor well below the current count; a real break drops to ~0.
    expect(enKeys.length).toBeGreaterThan(300);
  });

  for (const loc of LANGS.filter((l) => l !== 'en')) {
    const dict = read(loc);

    it(`${loc} defines every en key`, () => {
      const missing = enKeys.filter((key) => !(key in dict));
      expect(missing, `${loc} is missing ${missing.length} key(s): ${missing.join(', ')}`).toEqual([]);
    });

    it(`${loc} has no keys absent from en`, () => {
      const extra = Object.keys(dict).filter((key) => !(key in en));
      expect(extra, `${loc} has ${extra.length} stray key(s): ${extra.join(', ')}`).toEqual([]);
    });

    it(`${loc} has no empty or non-string values`, () => {
      const bad = Object.entries(dict).filter(([, v]) => typeof v !== 'string' || !v.trim()).map(([k]) => k);
      expect(bad, `${loc}: ${bad.join(', ')}`).toEqual([]);
    });

    it(`${loc} keeps the {placeholders} of the English text`, () => {
      const bad = enKeys.filter((key) => key in dict && placeholders(en[key]) !== placeholders(dict[key]));
      expect(bad, `${loc}: ${bad.join(', ')}`).toEqual([]);
    });
  }
});
