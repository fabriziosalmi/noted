// The patterns of our own inline syntax, shared by the parser (to recognise it) and the serializer
// (to know when ordinary text has to be escaped so it is not recognised). Keeping them in one place is
// what makes "what we write is what we read" hold.

/** `==highlighted==`: non-space inside the delimiters; a backslash escapes the next character. */
export const HIGHLIGHT = /==(?=\S)((?:\\.|[^\\])+?)(?<=\S)==/;

/** `$x^2$`: no space inside the dollars, not followed by a digit (so "$5 and $6" is prose). */
export const INLINE_MATH = /\$(?=[^\s$])((?:\\.|[^$\\\n])+?)(?<=\S)\$(?!\d)/;

/** `%%a comment%%` */
export const COMMENT = /%%(.+?)%%/;

/**
 * `[[Note]]`, `[[Note#Heading|alias]]`, `![[embed]]`, as the parser reads them. The text is a link whether or not
 * the editor has marked it (typing `[[Note]]` is how most links are made), so the serializer must write it as it is.
 */
export const WIKILINK = /!?\[\[[^\][\n]+\]\]/g;

/** The note a wikilink's inside text points at ("Note" in "Note#Heading|alias"), or null when there is none. */
export function wikilinkTarget(inner: string): string | null {
  return /^[^#|^]+/.exec(inner)?.[0].trim() || null;
}
