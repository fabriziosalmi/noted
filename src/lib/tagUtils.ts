/** Extract all #tags from HTML or plain text content */
export function extractTags(content: string): string[] {
  const text = content.replace(/<[^>]+>/g, ' ');
  // Allow one optional namespace segment (e.g. #project/minerva) so tags can
  // group notes; a second slash is not part of the tag.
  const matches = text.match(/#([a-zA-Z0-9_\-àèéìòùÀÈÉÌÒÙ]+(?:\/[a-zA-Z0-9_\-àèéìòùÀÈÉÌÒÙ]+)?)/g) ?? [];
  return [...new Set(matches.map(t => t.toLowerCase()))];
}

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
