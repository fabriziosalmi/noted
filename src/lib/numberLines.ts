// Line numbering for selected text. Pure string-in/string-out so the rules are tested without an editor.

const NUMBERED_LINE = /^\d+\.\s+/;

/** Prefix non-empty lines with sequential '1. ', '2. ', ... Empty lines keep their place and never get a number. If every non-empty line is already numbered, strip the prefixes instead. */
export function toggleNumberLines(text: string): string {
  const lines = text.split('\n');
  const isBlank = (line: string) => line.trim() === '';
  const allNumbered = lines.some((line) => !isBlank(line)) && lines.every((line) => isBlank(line) || NUMBERED_LINE.test(line));
  let count = 0;
  return lines
    .map((line) => {
      if (isBlank(line)) return line;
      if (allNumbered) return line.replace(NUMBERED_LINE, '');
      count += 1;
      return `${count}. ${line}`;
    })
    .join('\n');
}
