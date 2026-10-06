import { useStore } from '../store/useStore';
import { buildLinkResolver } from '../../shared/vault/resolve';
import { parseWikilinkText } from '../../shared/vault/wikilink';

export { linkLabel } from '../../shared/vault/wikilink';

/**
 * Follow a link written as a property value, the way a `[[link]]` in the text is followed: open the note it names (case does
 * not matter; a bare name finds the note in any folder; aliases count) at its heading or block, or make the note if there is none.
 */
export async function openLinkValue(raw: string): Promise<void> {
  const parts = parseWikilinkText(raw);
  const store = useStore.getState();
  if (!parts || !parts.target) return;
  const names = store.notes.map(n => n.name);
  const target = buildLinkResolver(names, store.noteAliasesIndex).resolve(parts.target, store.activeNoteName ?? undefined);
  if (!target) {
    await store.createTitledNote(parts.target);
    return;
  }
  if (parts.heading || parts.block) store.setPendingAnchor({ note: target, heading: parts.heading, block: parts.block });
  await store.openNote(target);
}
