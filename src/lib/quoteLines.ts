// Line quoting for selected text. Pure string-in/string-out so the rules are tested without an editor.

const QUOTED_LINE = /^>\s?/;

/** Prefix non-empty lines with '> '. Empty lines keep their place and never get quoted. If every non-empty line is already quoted, strip the prefixes instead. */
export function toggleQuoteLines(text: string): string {
  const lines = text.split('\n');
  const isBlank = (line: string) => line.trim() === '';
  const allQuoted = lines.some((line) => !isBlank(line)) && lines.every((line) => isBlank(line) || QUOTED_LINE.test(line));
  return lines
    .map((line) => {
      if (isBlank(line)) return line;
      if (allQuoted) return line.replace(QUOTED_LINE, '');
      return `> ${line}`;
    })
    .join('\n');
}
