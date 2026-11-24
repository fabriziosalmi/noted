import { useEffect, useSyncExternalStore } from 'react';
import { useStore } from '../store/useStore';
import { platformizeShortcut } from './platform';
import en from '../locales/en.json';
import { dictionaryFor, ensureLocale, subscribeLocales, localesVersion } from './locales';
import type { TranslationKey } from './translate';

export { ensureLocale } from './locales';
export { translate, type TranslationKey } from './translate';

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
