import { extractTags } from '../../shared/vault/extract';

/** What counts as a #tag is defined once, in shared/vault/extract.ts (the main-process index uses it too). */
export { extractTags };

/** Build a tag → note names index from an array of {name, text} objects */
export function buildTagIndex(notes: { name: string; text: string }[]): Record<string, string[]> {
  const idx: Record<string, string[]> = {};
  for (const { name, text } of notes) {
    for (const tag of extractTags(text)) {
      (idx[tag] ??= []).push(name);
    }
  }
  return idx;
}
