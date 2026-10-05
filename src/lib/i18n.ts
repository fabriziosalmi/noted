import { useEffect, useSyncExternalStore } from 'react';
import { useStore } from '../store/useStore';
import { platformizeShortcut } from './platform';
import en from '../locales/en.json';
import { dictionaryFor, ensureLocale, subscribeLocales, localesVersion } from './locales';

export { ensureLocale } from './locales';

// Keys come from the English dictionary (en.json): the other languages are
// checked against it by i18n.completeness.test.ts.
export type TranslationKey = keyof typeof en;

// Non-hook lookup, for code outside React (e.g. the Zustand store) that needs
// to produce a localized string from the current language. A language that has
// not finished loading answers in English until it has.
export function translate(key: TranslationKey, lang?: string): string {
  return platformizeShortcut((dictionaryFor(lang) as Record<string, string>)[key] ?? en[key]);
}

export function useI18n() {
  const language = useStore(s => s.settings.language ?? 'en');
  // Re-render when a language finishes loading, and start loading the current one.
  useSyncExternalStore(subscribeLocales, localesVersion);
  useEffect(() => { void ensureLocale(language); }, [language]);
  const dict = dictionaryFor(language);
  return {
    t: (key: TranslationKey) => platformizeShortcut((dict as Record<string, string>)[key] ?? en[key]),
    language,
  };
}
