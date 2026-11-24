import { platformizeShortcut } from './platform';
import en from '../locales/en.json';
import { dictionaryFor } from './locales';

// Keys come from the English dictionary (en.json): the other languages are
// checked against it by i18n.completeness.test.ts.
export type TranslationKey = keyof typeof en;

// Non-hook lookup, for code outside React (e.g. the Zustand store and templates)
// that needs to produce a localized string without creating a store <-> i18n cycle.
export function translate(key: TranslationKey, lang?: string): string {
  return platformizeShortcut((dictionaryFor(lang) as Record<string, string>)[key] ?? en[key]);
}
