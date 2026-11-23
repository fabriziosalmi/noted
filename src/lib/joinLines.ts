// Line joining for wrapped/selected text. Pure string-in/string-out so the rules are tested without an editor.

/** Trim each line, drop empty lines, and join the rest with single spaces. Empty/whitespace-only input yields ''. */
export function joinSelectedLines(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join(' ');
}
