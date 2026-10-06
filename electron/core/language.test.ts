// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let userData: string;
vi.mock('electron', () => ({ app: { getPath: () => userData } }));

import type * as LanguageModule from './language';
type Language = typeof LanguageModule;
let language: Language;

beforeEach(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'noted-lang-'));
  vi.resetModules();
  language = await import('./language');
});
afterEach(() => { fs.rmSync(userData, { recursive: true, force: true }); });

const remembered = (): unknown => JSON.parse(fs.readFileSync(path.join(userData, 'ui-language.json'), 'utf8'));

describe('the main process language', () => {
  it('is English until told otherwise, and fills placeholders', () => {
    expect(language.currentLanguage()).toBe('en');
    expect(language.tr('updAvailableMessage', { version: '1.5.0' })).toBe('Noted 1.5.0 is available.');
  });

  it('switches language, translates, and remembers it for the next start', async () => {
    expect(await language.setLanguage('it')).toBe(true);
    expect(language.tr('menuNewNote')).toBe('Nuova nota');
    expect(language.tr('updAvailableMessage', { version: '1.5.0' })).toBe('Noted 1.5.0 è disponibile.');
    expect(remembered()).toEqual({ language: 'it' });
  });

  it('starts in the remembered language, before anything else has told it', async () => {
    fs.writeFileSync(path.join(userData, 'ui-language.json'), '{"language":"de"}');
    await language.initLanguage();
    expect(language.currentLanguage()).toBe('de');
    expect(language.tr('menuFile')).toBe('Datei');
  });

  it('a missing, broken or unknown remembered language is English', async () => {
    await language.initLanguage();
    expect(language.currentLanguage()).toBe('en');
    for (const content of ['not json', 'null', '{"language":"klingon"}', '{"language":42}']) {
      fs.writeFileSync(path.join(userData, 'ui-language.json'), content);
      vi.resetModules();
      const fresh = await import('./language');
      await fresh.initLanguage();
      expect(fresh.currentLanguage(), content).toBe('en');
    }
  });

  it('refuses what is not a language and keeps the current one', async () => {
    await language.setLanguage('fr');
    for (const bad of ['klingon', '', 42, null, undefined, { language: 'it' }, '../it']) {
      expect(await language.setLanguage(bad), String(bad)).toBe(false);
    }
    expect(language.currentLanguage()).toBe('fr');
    expect(remembered()).toEqual({ language: 'fr' });
  });

  it('tells listeners once per real change (the menu is rebuilt then, not on every call)', async () => {
    const seen: string[] = [];
    const off = language.onLanguageChange(l => seen.push(l));
    await language.setLanguage('es');
    await language.setLanguage('es');
    await language.setLanguage('pt');
    off();
    await language.setLanguage('fr');
    expect(seen).toEqual(['es', 'pt']);
  });

  it('still works when the language cannot be written to disk', async () => {
    fs.rmSync(userData, { recursive: true, force: true });
    expect(await language.setLanguage('it')).toBe(true);
    expect(language.tr('menuFile')).toBe('File');
    expect(language.currentLanguage()).toBe('it');
  });

  it('falls back to the key, never throws, for a key that does not exist', () => {
    expect(language.tr('noSuchKey' as never)).toBe('noSuchKey');
  });
});
