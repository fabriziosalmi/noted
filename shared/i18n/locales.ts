// The translation dictionaries. English is bundled with the app (it is the
// fallback for every missing key); each other language is its own chunk, loaded
// the first time it is needed. Nothing here depends on the store, so the test
// setup can preload every language without booting the app.
import en from '../../src/locales/en.json';

export type Lang = 'en' | 'it' | 'es' | 'pt' | 'fr' | 'de';
export type Dictionary = Record<keyof typeof en, string>;

export const LANGS: readonly Lang[] = ['en', 'it', 'es', 'pt', 'fr', 'de'];

const loaders: Record<Exclude<Lang, 'en'>, () => Promise<{ default: unknown }>> = {
  it: () => import('../../src/locales/it.json'),
  es: () => import('../../src/locales/es.json'),
  pt: () => import('../../src/locales/pt.json'),
  fr: () => import('../../src/locales/fr.json'),
  de: () => import('../../src/locales/de.json'),
};

const loaded: Partial<Record<Lang, Dictionary>> = { en };
const pending = new Map<Lang, Promise<void>>();
const listeners = new Set<() => void>();
let version = 0;

const isLang = (l: unknown): l is Lang => typeof l === 'string' && (LANGS as readonly string[]).includes(l);

/** The dictionary for `lang` if it is loaded, else English (also for an unknown language). */
export function dictionaryFor(lang: string | undefined): Dictionary {
  return (isLang(lang) && loaded[lang]) || en;
}

export function isLoaded(lang: string | undefined): boolean {
  return isLang(lang) && !!loaded[lang];
}

/**
 * Load a language. Resolves when it is available (immediately for English or one
 * already loaded) and never rejects: a failed load leaves English in place, and
 * a later call tries again.
 */
export function ensureLocale(lang: string | undefined): Promise<void> {
  if (!isLang(lang) || loaded[lang]) return Promise.resolve();
  const inFlight = pending.get(lang);
  if (inFlight) return inFlight;
  const p = loaders[lang as Exclude<Lang, 'en'>]()
    .then((m) => {
      loaded[lang] = m.default as Dictionary;
      version++;
      for (const l of listeners) l();
    })
    .catch(() => undefined)
    .finally(() => pending.delete(lang));
  pending.set(lang, p);
  return p;
}

/** Load every language (tests, and anything that must translate into any of them synchronously). */
export function ensureAllLocales(): Promise<void> {
  return Promise.all(LANGS.map(ensureLocale)).then(() => undefined);
}

// For useSyncExternalStore: a component re-renders when a language finishes loading.
export function subscribeLocales(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
export const localesVersion = (): number => version;
