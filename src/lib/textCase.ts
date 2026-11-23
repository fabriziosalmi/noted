// Case conversions for selected text. Pure string-in/string-out so the rules are tested without an editor.

/** The case states a block of text can be cycled through, in order. */
export type TextCaseMode = 'lower' | 'upper' | 'title' | 'sentence';

const CYCLE: readonly TextCaseMode[] = ['lower', 'upper', 'title', 'sentence'];

/** Capitalise the first letter of every word, leaving the rest of each word unchanged. Unicode-aware. */
const titleCase = (text: string): string =>
  text.replace(/(^|\s)(\p{L})/gu, (_match, sep: string, letter: string) => sep + letter.toLocaleUpperCase());

/** Capitalise the first letter of the text and lower-case everything else. */
const sentenceCase = (text: string): string =>
  text
    .toLocaleLowerCase()
    .replace(/\p{L}/u, (letter) => letter.toLocaleUpperCase());

/** Convert `text` to the requested case mode. */
export function transformTextCase(text: string, mode: TextCaseMode): string {
  switch (mode) {
    case 'lower':
      return text.toLocaleLowerCase();
    case 'upper':
      return text.toLocaleUpperCase();
    case 'title':
      return titleCase(text);
    case 'sentence':
      return sentenceCase(text);
  }
}

/** Advance to the next mode in the cycle and apply it, returning the new mode alongside the transformed text. */
export function cycleTextCase(text: string, mode: TextCaseMode): { mode: TextCaseMode; text: string } {
  const next = CYCLE[(CYCLE.indexOf(mode) + 1) % CYCLE.length];
  return { mode: next, text: transformTextCase(text, next) };
}
