import { translate, type TranslationKey } from './i18n';

export type TemplateIconName =
  | 'meeting'
  | 'project'
  | 'research'
  | 'journal'
  | 'brainstorm'
  | 'custom';

export interface NoteTemplate {
  id: string;
  name: string;
  /** Lucide icon name resolved at render time — no inline emoji. */
  icon: TemplateIconName;
  content: string; // HTML
}

/** BCP-47 tag for date formatting, derived from the app language. */
const DATE_LOCALE: Record<string, string> = {
  en: 'en-US',
  it: 'it-IT',
  es: 'es-ES',
  pt: 'pt-PT',
  fr: 'fr-FR',
  de: 'de-DE',
};

/**
 * Built-in templates, localized to `lang`. Section headings and the meeting
 * date are rendered in the user's language; the HTML skeleton is unchanged so
 * external Markdown tools still read the notes.
 */
export function getBuiltinTemplates(lang: string): NoteTemplate[] {
  const t = (key: TranslationKey) => translate(key, lang);
  const dateLocale = DATE_LOCALE[lang] ?? 'en-US';
  const shortDate = new Date().toLocaleDateString(dateLocale);
  const longDate = new Date().toLocaleDateString(dateLocale, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return [
    {
      id: 'meeting',
      name: t('tmplMeeting'),
      icon: 'meeting',
      content: `<h1>${t('tmplMeeting')}</h1><p><strong>${t('tmplFieldDate')}:</strong> ${shortDate}</p><p><strong>${t('tmplFieldParticipants')}:</strong> </p><h2>${t('tmplSecAgenda')}</h2><ul><li><p></p></li></ul><h2>${t('tmplSecNotes')}</h2><p></p><h2>${t('tmplSecDecisions')}</h2><ul><li><p></p></li></ul><h2>${t('tmplSecActionItems')}</h2><ul><li><p></p></li></ul>`,
    },
    {
      id: 'project',
      name: t('tmplProject'),
      icon: 'project',
      content: `<h1>${t('tmplProject')}</h1><h2>${t('tmplSecGoal')}</h2><p></p><h2>${t('tmplSecScope')}</h2><ul><li><p></p></li></ul><h2>${t('tmplSecMilestones')}</h2><ul><li><p></p></li></ul><h2>${t('tmplSecResources')}</h2><p></p><h2>${t('tmplSecNotes')}</h2><p></p>`,
    },
    {
      id: 'research',
      name: t('tmplResearch'),
      icon: 'research',
      content: `<h1>${t('tmplResearch')}</h1><h2>${t('tmplSecQuestion')}</h2><p></p><h2>${t('tmplSecSources')}</h2><ul><li><p></p></li></ul><h2>${t('tmplSecSynthesis')}</h2><p></p><h2>${t('tmplSecConclusions')}</h2><p></p><h2>${t('tmplSecReferences')}</h2><p></p>`,
    },
    {
      id: 'journal',
      name: t('tmplJournal'),
      icon: 'journal',
      content: `<h1>${longDate}</h1><h2>${t('tmplSecHowIFeel')}</h2><p></p><h2>${t('tmplSecWhatHappened')}</h2><p></p><h2>${t('tmplSecGratitude')}</h2><ul><li><p></p></li></ul><h2>${t('tmplSecTomorrow')}</h2><p></p>`,
    },
    {
      id: 'brainstorm',
      name: t('tmplBrainstorm'),
      icon: 'brainstorm',
      content: `<h1>${t('tmplBrainstorm')}</h1><h2>${t('tmplSecTheme')}</h2><p></p><h2>${t('tmplSecFreeIdeas')}</h2><ul><li><p></p></li></ul><h2>${t('tmplSecBestIdeas')}</h2><ul><li><p></p></li></ul><h2>${t('tmplSecNextSteps')}</h2><ul><li><p></p></li></ul>`,
    },
  ];
}
