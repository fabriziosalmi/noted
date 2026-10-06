import { buildLinkResolver, linkPointsAtNote } from '../../shared/vault/resolve';

/**
 * Notes whose [[links]] point at `noteName`, from the vault index's
 * note -> link-targets map. Same resolution rule as the main process
 * (Obsidian's: case-insensitive, with or without ".md", a bare name finds the note
 * wherever it is), so the sidebar, the connections panel and the rename rewrite
 * always agree on what a backlink is.
 */
export function backlinksOf(noteLinksIndex: Record<string, string[]>, noteName: string): string[] {
  const resolver = buildLinkResolver(Object.keys(noteLinksIndex));
  return Object.entries(noteLinksIndex)
    .filter(([name, links]) => name !== noteName && links.some(l => linkPointsAtNote(resolver, l, noteName, name)))
    .map(([name]) => name);
}
