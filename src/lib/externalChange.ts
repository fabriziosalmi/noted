/**
 * What to do when the note open in the editor changes on disk behind its back
 * (a git sync pulled it, an MCP client wrote it, another device synced it).
 *
 * The editor only loads a note when it is opened, and autosave then writes the
 * editor's buffer over the file. Without handling, a pulled edit to the open note
 * would be silently overwritten by the next keystroke's autosave. The rule:
 *
 *  - disk equals what the editor loaded      -> nothing to do
 *  - disk differs, no unsaved typing         -> reload the editor from disk
 *  - disk differs AND there is unsaved typing -> keep the user's buffer (it is
 *    about to be saved) and ALSO keep the other version, as a sibling note, so
 *    neither side is ever lost
 *  - the file is gone                        -> leave the buffer; typing recreates it
 */

export interface LoadedNote {
  /** Body HTML, frontmatter comment already stripped (what the editor shows). */
  content: string;
  frontmatter: string | null;
}

export type ExternalChangePlan =
  | { kind: 'ignore' }
  | { kind: 'reload'; disk: LoadedNote }
  | { kind: 'keep-both' }
  | { kind: 'missing' };

export function planExternalChange(args: {
  /** The note as it is on disk right now, or null when it can't be read. */
  disk: LoadedNote | null;
  /** The note as the editor last loaded or saved it. */
  loaded: LoadedNote;
  /**
   * Typing that has not been confirmed saved yet (pending or in-flight autosave),
   * or null. If the file on disk already IS that buffer, our own write just landed
   * and there is no other version to keep.
   */
  unsaved: { content: string } | null;
}): ExternalChangePlan {
  const { disk, loaded, unsaved } = args;
  if (!disk) return { kind: 'missing' };
  if (disk.content === loaded.content && disk.frontmatter === loaded.frontmatter) return { kind: 'ignore' };
  if (unsaved) return disk.content === unsaved.content ? { kind: 'ignore' } : { kind: 'keep-both' };
  return { kind: 'reload', disk };
}

/**
 * Name for the preserved copy of the other version: "Note (other version).md",
 * then "Note (other version 2).md", ... Collision check is case-insensitive
 * because macOS/Windows filesystems treat those as the same file.
 */
export function otherVersionName(noteName: string, existing: Iterable<string>): string {
  const taken = new Set([...existing].map(n => n.toLowerCase()));
  const m = /^(.*?)(\.[^./]+)?$/.exec(noteName);
  const stem = m?.[1] ?? noteName;
  const ext = m?.[2] ?? '.md';
  let candidate = `${stem} (other version)${ext}`;
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) {
    candidate = `${stem} (other version ${n})${ext}`;
  }
  return candidate;
}
