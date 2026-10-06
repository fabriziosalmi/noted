import { buildLinkResolver, linkPointsAtNote, type AliasMap } from '../../shared/vault/resolve';

/**
 * Notes whose [[links]] point at `noteName`, from the vault index's
 * note -> link-targets map. Same resolution rule as the main process
 * (Obsidian's: case-insensitive, with or without ".md", a bare name finds the note
 * wherever it is), so the sidebar, the connections panel and the rename rewrite
 * always agree on what a backlink is. A note's aliases count: a link to an alias is a link to the note.
 */
export function backlinksOf(noteLinksIndex: Record<string, string[]>, noteName: string, aliases: AliasMap = {}): string[] {
  const resolver = buildLinkResolver(Object.keys(noteLinksIndex), aliases);
  return Object.entries(noteLinksIndex)
    .filter(([name, links]) => name !== noteName && links.some(l => linkPointsAtNote(resolver, l, noteName, name)))
    .map(([name]) => name);
}
