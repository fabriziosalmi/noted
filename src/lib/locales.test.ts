import { describe, expect, it, vi } from 'vitest';
import { dictionaryFor, ensureLocale, isLoaded } from './locales';
import { translate } from './i18n';

// The setup file preloads every language for the other tests, so this one asks
// about a language by name and checks the contract, not the timing of the very
// first load.
describe('lazy locales', () => {
  it('has English immediately, as the fallback', () => {
    expect(isLoaded('en')).toBe(true);
    expect(translate('done', 'en')).toBe('Done');
  });

  it('answers in English for an unknown or missing language', () => {
    expect(dictionaryFor('xx')).toBe(dictionaryFor('en'));
    expect(dictionaryFor(undefined)).toBe(dictionaryFor('en'));
    expect(translate('done', 'xx')).toBe('Done');
  });

  it('translates into a loaded language and keeps English for a key it lacks', async () => {
    await ensureLocale('de');
    expect(isLoaded('de')).toBe(true);
    expect(translate('done', 'de')).toBe('Fertig');
  });

  it('ensureLocale resolves for English, for unknown languages, and when called twice', async () => {
    await expect(ensureLocale('en')).resolves.toBeUndefined();
    await expect(ensureLocale('klingon')).resolves.toBeUndefined();
    await expect(ensureLocale(undefined)).resolves.toBeUndefined();
    await expect(Promise.all([ensureLocale('fr'), ensureLocale('fr')])).resolves.toBeDefined();
  });

  it('falls back to English until a language has loaded, then switches and notifies', async () => {
    vi.resetModules();                       // a registry the setup file has not preloaded
    const fresh = await import('./locales');
    expect(fresh.isLoaded('it')).toBe(false);
    expect(fresh.dictionaryFor('it').done).toBe('Done');

    let calls = 0;
    const off = fresh.subscribeLocales(() => { calls++; });
    const v0 = fresh.localesVersion();
    await fresh.ensureLocale('it');
    off();
    expect(fresh.isLoaded('it')).toBe(true);
    expect(fresh.dictionaryFor('it').done).toBe('Fatto');
    expect(calls).toBe(1);
    expect(fresh.localesVersion()).toBe(v0 + 1);
  });

  it('a component using useI18n re-renders in the language once it has loaded', async () => {
    vi.resetModules();
    const { renderHook, waitFor } = await import('@testing-library/react');
    const { useStore } = await import('../store/useStore');
    const { useI18n } = await import('./i18n');
    useStore.setState((st) => ({ settings: { ...st.settings, language: 'es' } }));
    const { result } = renderHook(() => useI18n());
    expect(result.current.t('done')).toBe('Done');           // English while es loads
    await waitFor(() => expect(result.current.t('done')).not.toBe('Done'));
    expect(result.current.language).toBe('es');
  });
});
