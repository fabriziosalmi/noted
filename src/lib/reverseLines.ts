// Line-order reversal for selected text. Pure string-in/string-out so the rules are tested without an editor.

/** Reverse the order of the lines in `text`. Line count is preserved, including empty lines. */
export function reverseSelectedLines(text: string): string {
  return text.split('\n').reverse().join('\n');
}
