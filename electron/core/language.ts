// The language of what the main process shows: update dialogs, the native menu, file dialogs. The renderer owns
// the setting (settings.language) and tells main on start and on every change; main keeps a copy on disk so the
// next start shows the menu in the right language before the window has loaded anything.
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { LANGS, dictionaryFor, ensureLocale, type Dictionary, type Lang } from '../../shared/i18n/locales';
import { fillTemplate } from '../../shared/i18n/format';

export type TranslationKey = keyof Dictionary;

let current: Lang = 'en';
const listeners = new Set<(lang: Lang) => void>();

const isLang = (value: unknown): value is Lang => typeof value === 'string' && (LANGS as readonly string[]).includes(value);
const file = (): string => path.join(app.getPath('userData'), 'ui-language.json');

export const currentLanguage = (): Lang => current;

/** What a string says in the current language, falling back to English for a key a language does not have. */
export function tr(key: TranslationKey, values?: Record<string, string | number>): string {
  const dict = dictionaryFor(current) as Record<string, string>;
  const en = dictionaryFor('en') as Record<string, string>;
  return fillTemplate(dict[key] ?? en[key] ?? key, values);
}

/** Read the language remembered from the last run. Never throws: no file, or a bad one, is English. */
export async function initLanguage(): Promise<void> {
  try {
    const raw = JSON.parse(fs.readFileSync(file(), 'utf8')) as { language?: unknown } | null;
    if (raw && isLang(raw.language)) current = raw.language;
  } catch { /* first run */ }
  await ensureLocale(current);
}

/** Use `value` from now on and tell whoever shows it (the menu is rebuilt). Anything that is not a language is refused. */
export async function setLanguage(value: unknown): Promise<boolean> {
  if (!isLang(value)) return false;
  await ensureLocale(value);
  if (value === current) return true;
  current = value;
  try {
    const target = file();
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ language: value }) + '\n', 'utf8');
    fs.renameSync(tmp, target);
  } catch { /* remembering is a convenience: this run already uses the new language */ }
  for (const listener of listeners) listener(current);
  return true;
}

export function onLanguageChange(listener: (lang: Lang) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
