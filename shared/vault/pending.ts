/**
 * Changes an agent asked for in a place where its writes need approval (`staged` in the policy): kept as files in
 * `.noted/pending/` until the user approves or rejects them in the app. Each holds the note as it was, and as it would be, so
 * the review shows exactly what approving does. The MCP server writes them and the app reads and settles them (the files themselves: pendingFile.ts).
 */
export type PendingKind = 'create' | 'update' | 'delete';

export interface PendingChange {
  id: string;
  /** ISO time the agent asked. */
  createdAt: string;
  /** The MCP client's own name for itself (not verified), for the review. */
  client: string;
  /** The tool that asked. */
  tool: string;
  kind: PendingKind;
  /** Vault-relative note name. */
  note: string;
  /** Etag of the note when the change was made (null for a new note): approving is refused if the note is no longer that. */
  baseEtag: string | null;
  /** The note as the agent saw it (null for a new note). */
  before: string | null;
  /** The note as it would be (null to delete it). */
  after: string | null;
}

export const MAX_PENDING = 200;
export const MAX_PENDING_BYTES = 5 * 1024 * 1024;

export const PENDING_ID = /^[0-9a-f]{16}$/;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const orNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** A pending change from what was read of a file, or null when it is not one (a damaged file is skipped, never trusted). */
export function parsePending(raw: unknown): PendingChange | null {
  if (!isRecord(raw)) return null;
  const { id, createdAt, client, tool, kind, note } = raw;
  if (typeof id !== 'string' || !PENDING_ID.test(id) || typeof createdAt !== 'string' || Number.isNaN(Date.parse(createdAt))) return null;
  if (typeof client !== 'string' || typeof tool !== 'string' || typeof note !== 'string' || !note) return null;
  if (kind !== 'create' && kind !== 'update' && kind !== 'delete') return null;
  const before = orNull(raw.before);
  const after = orNull(raw.after);
  if (kind === 'create' && (before !== null || after === null)) return null;
  if (kind === 'update' && (before === null || after === null)) return null;
  if (kind === 'delete' && (before === null || after !== null)) return null;
  return { id, createdAt, client: client.slice(0, 100), tool: tool.slice(0, 50), kind, note, baseEtag: orNull(raw.baseEtag), before, after };
}
