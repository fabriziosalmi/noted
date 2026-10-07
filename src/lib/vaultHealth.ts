import type { Finding, FindingKind, LintReport } from '../../shared/lint/vaultLint';
import { SUMMARY_FIELDS } from '../../shared/lint/vaultLint';
import { translate, type TranslationKey } from './i18n';

/** The sections of the report, in the order they are shown. */
export const KIND_ORDER: readonly FindingKind[] = ['broken-link', 'broken-heading', 'isolated', 'duplicate', 'near-duplicate', 'same-name', 'stale', 'empty', 'no-summary'];

export const KIND_TITLE: Record<FindingKind, TranslationKey> = {
  'broken-link': 'healthKindBrokenLink', 'broken-heading': 'healthKindBrokenHeading', isolated: 'healthKindIsolated', duplicate: 'healthKindDuplicate',
  'near-duplicate': 'healthKindNear', 'same-name': 'healthKindSameName', stale: 'healthKindStale', empty: 'healthKindEmpty', 'no-summary': 'healthKindNoSummary',
};
export const KIND_DESC: Record<FindingKind, TranslationKey> = {
  'broken-link': 'healthDescBrokenLink', 'broken-heading': 'healthDescBrokenHeading', isolated: 'healthDescIsolated', duplicate: 'healthDescDuplicate',
  'near-duplicate': 'healthDescNear', 'same-name': 'healthDescSameName', stale: 'healthDescStale', empty: 'healthDescEmpty', 'no-summary': 'healthDescNoSummary',
};

const fill = (text: string, params: Record<string, string | number>): string => Object.entries(params).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), text);
const stem = (name: string): string => name.replace(/\.md$/i, '');
/** A link to a note that exists. */
const link = (name: string): string => `[[${stem(name)}]]`;
/** A name that may not exist: written plainly, so that the report does not add a link to nothing. */
const plain = (text: string): string => text.replace(/[[\]]/g, '');

export const reportFolder = 'reports';

/** Where a report made on `date` goes. */
export function reportName(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${reportFolder}/Vault health ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.md`;
}

function line(f: Finding, tr: (key: TranslationKey, params?: Record<string, string | number>) => string): string {
  switch (f.kind) {
    case 'broken-link':
      return `- ${link(f.note)} ${tr('healthLinksTo')} ${plain(f.target)}${f.suggestion ? ` (${tr('healthMeant', { name: link(f.suggestion) })})` : ''}`;
    case 'broken-heading':
      return `- ${link(f.note)} ${tr('healthLinksTo')} ${link(f.resolved)} › ${plain(f.heading)}`;
    case 'isolated': case 'empty':
      return `- ${link(f.note)}`;
    case 'duplicate':
      return `- ${f.notes.map(link).join(' = ')}`;
    case 'near-duplicate':
      return `- ${f.notes.map(link).join(' ≈ ')} (${tr('healthAlike', { n: Math.round(f.similarity * 100) })})`;
    case 'same-name':
      return `- ${f.notes.map(link).join(', ')}`;
    case 'stale':
      return `- ${link(f.note)} (${tr('healthAgo', { n: f.days })})`;
    case 'no-summary':
      return `- ${link(f.note)} (${tr('healthWords', { n: f.words })})`;
  }
}

/**
 * The report as a note: what was found, grouped, each note a link to open. A suggestion is written as a link, a missing
 * name only as text, and nothing here changes the notes: the fixes are in the app, on the Vault health page.
 */
export function reportMarkdown(report: LintReport, lang: string, date: Date): string {
  const tr = (key: TranslationKey, params: Record<string, string | number> = {}) => fill(translate(key, lang), params);
  const day = reportName(date).replace(/^.*Vault health (\d{4}-\d{2}-\d{2})\.md$/, '$1');
  const out: string[] = [
    `# ${tr('healthTitle')} ${day}`,
    '',
    tr('healthIntro', { n: report.notes, found: report.findings.length }),
    '',
  ];
  if (report.findings.length === 0) out.push(tr('healthClean'), '');
  for (const kind of KIND_ORDER) {
    const found = report.findings.filter(f => f.kind === kind);
    if (found.length === 0) continue;
    out.push(`## ${tr(KIND_TITLE[kind])} (${found.length})`, '', kind === 'no-summary' ? tr(KIND_DESC[kind], { n: report.options.summaryMinWords }) : tr(KIND_DESC[kind]), '');
    for (const f of found) out.push(line(f, tr));
    out.push('');
  }
  if (report.unread.length > 0) out.push(tr('healthUnread', { n: report.unread.length }), '');
  out.push(`*${tr('healthReportFooter')}*`, '');
  return out.join('\n');
}

export { SUMMARY_FIELDS };
