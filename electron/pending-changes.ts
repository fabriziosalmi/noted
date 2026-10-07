/**
 * Settling the changes agents proposed in `staged` places: approving one makes it, rejecting one drops it. Approving is
 * refused, and the change kept, if the note is no longer the version the agent saw (it was changed by you, a sync, or another
 * agent), so an approval can never overwrite something it did not know about.
 */
import { checkNotePath } from '../shared/vault/paths.js';
import { etagOf } from '../shared/vault/etag.js';
import { getPending, removePending } from '../shared/vault/pendingFile.js';

export interface PendingDeps {
  notesDir: string;
  /** The note's current text, or null when there is no such note. */
  readNote: (name: string) => Promise<string | null>;
  /** Keep the PREVIOUS content in the note's history. */
  snapshotBefore: (name: string, previousContent: string) => Promise<void>;
  /** Durable, atomic write, plus whatever index bookkeeping the caller does. */
  writeNote: (name: string, content: string) => Promise<void>;
  /** Move the note to the trash (recoverable). */
  trashNote: (name: string) => void;
  /** Record the change in the agent journal before it is made; throws if it cannot be recorded. */
  record?: (entry: { client: string; tool: string; kind: 'create' | 'update' | 'delete'; note: string; before: string | null; after: string | null }) => void;
}

export type Settled = { ok: true } | { ok: false; error: string; conflict?: boolean };

export async function approvePending(deps: PendingDeps, id: string): Promise<Settled> {
  const change = getPending(deps.notesDir, id);
  if (!change) return { ok: false, error: 'that change is no longer waiting' };
  const bad = checkNotePath(change.note, 'Note name');
  if (bad) return { ok: false, error: bad };

  const current = await deps.readNote(change.note);
  if (change.kind === 'create') {
    if (current !== null) return { ok: false, error: 'a note with that name exists now', conflict: true };
    deps.record?.({ client: change.client, tool: change.tool, kind: 'create', note: change.note, before: null, after: change.after });
    await deps.writeNote(change.note, change.after ?? '');
  } else if (change.kind === 'update') {
    if (current === null) return { ok: false, error: 'the note was deleted since', conflict: true };
    if (etagOf(current) !== change.baseEtag) return { ok: false, error: 'the note was changed since the agent saw it', conflict: true };
    deps.record?.({ client: change.client, tool: change.tool, kind: 'update', note: change.note, before: current, after: change.after });
    await deps.snapshotBefore(change.note, current);
    await deps.writeNote(change.note, change.after ?? '');
  } else if (current !== null) {
    if (etagOf(current) !== change.baseEtag) return { ok: false, error: 'the note was changed since the agent saw it', conflict: true };
    deps.record?.({ client: change.client, tool: change.tool, kind: 'delete', note: change.note, before: current, after: null });
    await deps.snapshotBefore(change.note, current);
    deps.trashNote(change.note);
  }
  removePending(deps.notesDir, id);
  return { ok: true };
}

export function rejectPending(notesDir: string, id: string): Settled {
  if (!getPending(notesDir, id)) return { ok: false, error: 'that change is no longer waiting' };
  removePending(notesDir, id);
  return { ok: true };
}
