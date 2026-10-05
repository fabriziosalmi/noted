/** Compile-time guard: the producer (vault-index.ts) and the renderer's copy of the wire types must agree. */
import type { IndexSnapshot, IndexDelta, NoteView } from './vault-index';
import type { VaultIndexSnapshot, VaultIndexDelta, VaultIndexNoteView } from '../src/lib/vaultIndexTypes';

type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

export const snapshotMatches: Equal<IndexSnapshot, VaultIndexSnapshot> = true;
export const deltaMatches: Equal<IndexDelta, VaultIndexDelta> = true;
export const viewMatches: Equal<NoteView, VaultIndexNoteView> = true;
