/**
 * A fingerprint of a note's stored text, for optimistic concurrency: an edit says which version it was made against, and is
 * refused if the note has changed since. Content, not a timestamp: a touch or a sync that rewrites the same text is no change.
 */
import { createHash } from 'node:crypto';

export function etagOf(stored: string): string {
  return createHash('sha256').update(stored, 'utf8').digest('hex').slice(0, 16);
}

/** The full SHA-256 of a text, in hex: what the agent journal records of a note's content before and after a change. */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
