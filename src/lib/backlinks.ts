import { linkPointsAt } from '../../shared/vault/extract';

/**
 * Notes whose [[links]] point at `noteName`, from the vault index's
 * note -> link-targets map. Same matching rule as the main process
 * (case-insensitive, with or without ".md"), so the sidebar, the connections
 * panel and the rename rewrite always agree on what a backlink is.
 */
export function backlinksOf(noteLinksIndex: Record<string, string[]>, noteName: string): string[] {
  return Object.entries(noteLinksIndex)
    .filter(([name, links]) => name !== noteName && links.some(l => linkPointsAt(l, noteName)))
    .map(([name]) => name);
}
