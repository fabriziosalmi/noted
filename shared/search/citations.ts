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

// Splits prose from code (fenced and inline) the way linkCitations does, so code is left as written: in a fenced block
// "    return a[3]" keeps its indentation and index, and inline `x[1]` is not read as a citation. Even indexes are prose.
const inProse = (answer: string, f: (prose: string) => string): string =>
  answer.split(CODE).map((part, i) => (i % 2 === 1 ? part : f(part))).join('');

// The spaces a removed marker leaves between two words ("A [7] B" -> "A  B"). Only those collapse: a line's indentation
// (a nested list item) and its trailing spaces (a Markdown hard line break) stay as written. Code is left out, but it
// stands for a word, so the spaces next to `code` in the middle of a line still collapse.
const BETWEEN_WORDS = /(\S) {2,}(?=\S)/g;
// The space a removed marker leaves before punctuation ("Done [2]." -> "Done ."). The lookbehind starts a match only
// at the first space of a run: without it every space of a long run was tried again, quadratic (1.5 s on 50,000 spaces).
const BEFORE_PUNCTUATION = /(?<![ \t])[ \t]+([.,;:!?])/g;
const CODE_STAND_IN = '\u0000';

function tidySpaces(text: string): string {
  const parts = text.split(CODE);
  if (text.includes(CODE_STAND_IN)) return parts.map((p, i) => (i % 2 === 1 ? p : p.replace(BETWEEN_WORDS, '$1 '))).join('');
  const prose = parts.filter((_, i) => i % 2 === 0).join(CODE_STAND_IN).replace(BETWEEN_WORDS, '$1 ').split(CODE_STAND_IN);
  return parts.map((p, i) => (i % 2 === 1 ? p : prose[i / 2])).join('');
}

/** Reads the citations of an answer against the number of sources that were offered. */
export function readCitations(answer: string, sourceCount: number): CitedAnswer {
  const cited: number[] = [];
  const invalid: number[] = [];
  const text = tidySpaces(inProse(answer, prose => prose.replace(GROUP, (whole, list: string) => {
    const numbers = list.split(',').map(x => Number(x.trim()));
    const good = numbers.filter(n => n >= 1 && n <= sourceCount);
    for (const n of numbers) {
      if (n >= 1 && n <= sourceCount) { if (!cited.includes(n)) cited.push(n); }
      else if (!invalid.includes(n)) invalid.push(n);
    }
    return good.length === 0 ? '' : good.length === numbers.length ? whole : `[${good.join(', ')}]`;
  }).replace(BEFORE_PUNCTUATION, '$1')));
  return { text, cited, invalid };
}

/** An earlier answer, without its markers: the numbers belonged to the sources of that turn, not of the next one. */
export function stripCitations(answer: string): string {
  return tidySpaces(inProse(answer, prose => prose.replace(GROUP, '').replace(BEFORE_PUNCTUATION, '$1')));
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
