// What an import tells you afterwards: how many notes came across, and for each one that did not come across whole, what changed. Shared by
// the importers (Evernote now, Notion next), pure, and small enough to read in the dialog and to keep as a note.

/** `lossy`: words or content that are not in the result. `formatting`: only styling was dropped. `skipped`: something was not imported at all. */
export type FindingLevel = 'lossy' | 'formatting' | 'skipped';

export interface ImportFinding { note: string; level: FindingLevel; message: string }

export interface ImportReport {
  source: string;
  imported: number;
  /** Attachments stored in the vault. */
  attachments: number;
  findings: ImportFinding[];
  /** Findings left out of the list to keep it readable (counted, never silently). */
  unlisted: number;
}

export const MAX_LISTED_FINDINGS = 500;

export const createReport = (source: string): ImportReport => ({ source, imported: 0, attachments: 0, findings: [], unlisted: 0 });

export function addFinding(report: ImportReport, finding: ImportFinding): void {
  if (report.findings.length >= MAX_LISTED_FINDINGS) report.unlisted++;
  else report.findings.push(finding);
}

export interface ReportCounts { lossy: number; formatting: number; skipped: number; notes: number }

/** How many notes each level touched (a note counts once per level, however many findings it has). */
export function countReport(report: ImportReport): ReportCounts {
  const by = (level: FindingLevel) => new Set(report.findings.filter((f) => f.level === level).map((f) => f.note)).size;
  return { lossy: by('lossy'), formatting: by('formatting'), skipped: by('skipped'), notes: report.imported };
}

/** One report from several: what came across, and everything that was said about it, in the order of the files. */
export function mergeReports(source: string, reports: ImportReport[]): ImportReport {
  const merged = createReport(source);
  for (const r of reports) {
    merged.imported += r.imported;
    merged.attachments += r.attachments;
    merged.unlisted += r.unlisted;
    for (const f of r.findings) addFinding(merged, f);
  }
  return merged;
}

/** What the dialog tells you, once the import is done; the whole list is in the report note. */
export interface ImportSummary { lossy: number; skipped: number; formatting: number; attachments: number; reportFile: string | null }

export function summarize(report: ImportReport, reportFile: string | null): ImportSummary {
  const c = countReport(report);
  return { lossy: c.lossy, skipped: c.skipped, formatting: c.formatting, attachments: report.attachments, reportFile };
}

const HEADINGS: Record<FindingLevel, string> = {
  lossy: 'Content that did not come across',
  skipped: 'Not imported',
  formatting: 'Styling that was dropped',
};

/** The report as a Markdown note. `generated` is a date the caller formats, so this stays free of the clock. */
export function reportToMarkdown(report: ImportReport, generated: string): string {
  const counts = countReport(report);
  const out = [
    `# Import report: ${report.source}`,
    '',
    `Generated ${generated}.`,
    '',
    `- Notes imported: ${report.imported}`,
    `- Attachments stored: ${report.attachments}`,
    `- Notes with content that did not come across: ${counts.lossy}`,
    `- Items not imported: ${counts.skipped}`,
    `- Notes whose styling was simplified: ${counts.formatting}`,
    '',
  ];
  for (const level of ['lossy', 'skipped', 'formatting'] as const) {
    const items = report.findings.filter((f) => f.level === level);
    if (items.length === 0) continue;
    out.push(`## ${HEADINGS[level]}`, '');
    for (const f of items) out.push(`- **${f.note}**: ${f.message}`);
    out.push('');
  }
  if (report.unlisted > 0) out.push(`${report.unlisted} more findings are not listed.`, '');
  if (report.findings.length === 0) out.push('Nothing was lost: every note came across whole.', '');
  return `${out.join('\n').trimEnd()}\n`;
}
