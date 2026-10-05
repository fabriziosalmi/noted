/**
 * The attachments folder name: pure and runtime-agnostic, so the renderer's
 * settings field and the main process apply exactly the same rule.
 */

export const DEFAULT_ATTACHMENTS_FOLDER = 'attachments';

/** One folder level, plain name: it is also a path segment on every OS and never a hidden folder. */
export function isValidAttachmentsFolder(name: unknown): name is string {
  return typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/.test(name) && !/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(name);
}
