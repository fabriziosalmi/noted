// Line bulleting for selected text. Pure string-in/string-out so the rules are tested without an editor.

const BULLETED_LINE = /^[-*]\s+/;

/** Prefix non-empty lines with '- '. Empty lines keep their place and never get a bullet. If every non-empty line is already bulleted, strip the prefixes instead. */
export function toggleBulletLines(text: string): string {
  const lines = text.split('\n');
  const isBlank = (line: string) => line.trim() === '';
  const allBulleted = lines.some((line) => !isBlank(line)) && lines.every((line) => isBlank(line) || BULLETED_LINE.test(line));
  return lines
    .map((line) => {
      if (isBlank(line)) return line;
      if (allBulleted) return line.replace(BULLETED_LINE, '');
      return `- ${line}`;
    })
    .join('\n');
}
