// Sources and citations in a chat answer. The sources the model was shown are numbered; it is asked to put [n] after what a
// source supports; here the numbers it wrote are read back, checked against the sources that exist, and turned into
// something a person can follow. Pure: text in, text out.

/** A section of a note offered to the model as a source. */
export interface Source {
  /** 1-based number the model sees. */
  n: number;
  name: string;
  title: string;
  headingPath: string[];
  text: string;
}

export const sourceLabel = (s: Pick<Source, 'title' | 'headingPath'>): string => [s.title, ...s.headingPath].join(' › ');

/** The sources as the prompt shows them, each under its number. */
export function sourcesBlock(sources: readonly Source[]): string {
  return sources.map(s => `[${s.n}] ${sourceLabel(s)}\n${s.text}`).join('\n\n---\n\n');
}

// "[1]", "[1, 2]", "[1,2,3]": a bracket holding only numbers and commas. "[link](x)", "[x]" and "[2024]"-sized numbers are not citations
// (a source number is at most two digits: nobody offers a model a hundred sources).
const GROUP = /\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\]/g;

export interface CitedAnswer {
  /** The answer with markers for numbers that are no source removed (a model can invent "[7]"). */
  text: string;
  /** The numbers cited, once each, in the order they first appear. */
  cited: number[];
  /** Markers that named no source. */
  invalid: number[];
}

/** Reads the citations of an answer against the number of sources that were offered. */
export function readCitations(answer: string, sourceCount: number): CitedAnswer {
  const cited: number[] = [];
  const invalid: number[] = [];
  const text = answer.replace(GROUP, (whole, list: string) => {
    const numbers = list.split(',').map(x => Number(x.trim()));
    const good = numbers.filter(n => n >= 1 && n <= sourceCount);
    for (const n of numbers) {
      if (n >= 1 && n <= sourceCount) { if (!cited.includes(n)) cited.push(n); }
      else if (!invalid.includes(n)) invalid.push(n);
    }
    return good.length === 0 ? '' : good.length === numbers.length ? whole : `[${good.join(', ')}]`;
  }).replace(/[ \t]+([.,;:!?])/g, '$1').replace(/ {2,}/g, ' ');
  return { text, cited, invalid };
}

/** An earlier answer, without its markers: the numbers belonged to the sources of that turn, not of the next one. */
export function stripCitations(answer: string): string {
  return answer.replace(GROUP, '').replace(/[ \t]+([.,;:!?])/g, '$1').replace(/ {2,}/g, ' ');
}

/** The numbers of a "[1, 2]" marker's text, for a click handler. */
export function citationNumbers(marker: string): number[] {
  const m = /^\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\]$/.exec(marker.trim());
  return m ? m[1].split(',').map(x => Number(x.trim())) : [];
}

export interface Support {
  coverage: number;
  similarity: number | null;
}

/** Cosine similarity at or above which a section found by meaning alone counts as supporting an answer. A heuristic: models differ. */
export const MIN_SUPPORTING_SIMILARITY = 0.3;
/** Share of the question's significant words a section must contain to count as supporting an answer by words. */
export const MIN_SUPPORTING_COVERAGE = 0.5;

/** Whether a retrieved section is evidence for an answer, or only the nearest thing the vault had. */
export function supports(c: Support): boolean {
  return c.coverage >= MIN_SUPPORTING_COVERAGE || (c.similarity ?? 0) >= MIN_SUPPORTING_SIMILARITY;
}

const CODE = /(`{3,}[\s\S]*?(?:`{3,}|$)|`[^`\n]*`)/g;

/**
 * The answer's [n] markers as Markdown links to "#cite-n" (title: where the source is from), so that rendering the answer turns
 * them into something to click. Code, fenced or inline, is left as it is: "a[1]" in a snippet is not a citation. Run it on an
 * answer that `readCitations` has checked, or markers naming no source become dead links.
 */
export function linkCitations(markdown: string, sources: readonly Pick<Source, 'n' | 'title' | 'headingPath'>[]): string {
  const byNumber = new Map(sources.map(s => [s.n, s]));
  return markdown.split(CODE).map((part, i) => {
    if (i % 2 === 1) return part; // a code span: split keeps the separators at odd places
    return part.replace(GROUP, (whole, list: string) => {
      const links = list.split(',').map(x => Number(x.trim())).filter(n => byNumber.has(n))
        .map(n => `[${n}](#cite-${n} "${sourceLabel(byNumber.get(n) as Source).replace(/"/g, "'")}")`);
      return links.length > 0 ? links.join('') : whole;
    });
  }).join('');
}

/** The number a "#cite-n" link stands for, or null. */
export function citationOfHref(href: string | null | undefined): number | null {
  const m = /^#cite-(\d{1,2})$/.exec(href ?? '');
  return m ? Number(m[1]) : null;
}
