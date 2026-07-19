import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Locale-parity gate. The `translations` object in i18n.ts holds every locale in
// one file, so we parse it textually (importing i18n.ts would boot the whole
// store). This guards the invariant that ships to users: every non-`en` locale
// defines every `en` key, with no stray keys. If it fails, run the missing-key
// detector and complete the locale before merging.
const LOCALES = ['en', 'it', 'es', 'pt', 'fr', 'de'] as const;

function localeKeys(): Record<string, Set<string>> {
  const src = readFileSync(join(import.meta.dirname, 'i18n.ts'), 'utf8');
  const start = src.indexOf('const translations');
  const end = src.indexOf('} satisfies', start);
  if (start === -1 || end === -1) throw new Error('could not locate translations object');
  const body = src.slice(src.indexOf('{', start) + 1, end);

  const out: Record<string, Set<string>> = {};
  for (const loc of LOCALES) {
    const re = new RegExp(`\\n  ${loc}:\\s*\\{`);
    const m = re.exec(body);
    if (!m) {
      out[loc] = new Set();
      continue;
    }
    // Walk braces from the block's opening { to its matching close.
    const open = body.indexOf('{', m.index);
    let depth = 0;
    let close = -1;
    for (let j = open; j < body.length; j++) {
      if (body[j] === '{') depth++;
      else if (body[j] === '}') {
        depth--;
        if (depth === 0) {
          close = j;
          break;
        }
      }
    }
    const block = body.slice(open + 1, close);
    const keys = new Set<string>();
    const kv = /(\w+)\s*:\s*(['"])((?:\\.|(?!\2).)*)\2/g;
    let k: RegExpExecArray | null;
    while ((k = kv.exec(block)) !== null) keys.add(k[1]);
    out[loc] = keys;
  }
  return out;
}

describe('i18n locale completeness', () => {
  const keys = localeKeys();
  const enKeys = [...keys.en];

  it('parses a sane number of en keys (guards against parser drift)', () => {
    // Floor well below the current count; a real break drops to ~0.
    expect(enKeys.length).toBeGreaterThan(300);
  });

  for (const loc of LOCALES.filter((l) => l !== 'en')) {
    it(`${loc} defines every en key`, () => {
      const missing = enKeys.filter((key) => !keys[loc].has(key));
      expect(missing, `${loc} is missing ${missing.length} key(s): ${missing.join(', ')}`).toEqual([]);
    });

    it(`${loc} has no keys absent from en`, () => {
      const extra = [...keys[loc]].filter((key) => !keys.en.has(key));
      expect(extra, `${loc} has ${extra.length} stray key(s): ${extra.join(', ')}`).toEqual([]);
    });
  }
});
