// Blank-line and duplicate-line removal for selected text. Pure string-in/string-out so the rules are tested without an editor.

/** Drop whitespace-only lines and later duplicates (case-sensitive, compared trimmed), keeping each first occurrence as written. */
export function removeBlankAndDuplicateLines(text: string): string {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const line of text.split('\n')) {
    const key = line.trim();
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    kept.push(line);
  }
  return kept.join('\n');
}
