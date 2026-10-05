/**
 * Keep [[wikilinks]] valid when notes are renamed or moved: find the notes that
 * link to the old names (from the vault index, after reconciling it with the
 * disk), rewrite their links, and write each back atomically with a history
 * snapshot of what it looked like before, so the change can be undone.
 *
 * Disk access goes through injected functions so main can supply its durable
 * write, history snapshot and index/search updates, and tests can use a temp dir.
 */

import { rewriteWikilinks, type NoteRename } from '../shared/vault/links.js';
import type { VaultIndex } from './vault-index.js';

export interface RewriteDeps {
  vaultIndex: Pick<VaultIndex, 'reconcile' | 'backlinks'>;
  readNote: (name: string) => Promise<string>;
  /** Store the PREVIOUS content in the note's history, unconditionally. */
  snapshotBefore: (name: string, previousContent: string) => Promise<void>;
  /** Durable, atomic write, plus whatever index/search bookkeeping main does. */
  writeNote: (name: string, content: string) => Promise<void>;
}

export interface PlannedNote {
  name: string;
  /** How many links in this note change. */
  links: number;
  content: string;
  previous: string;
}

export interface RewriteOutcome {
  /** Notes rewritten. */
  notes: string[];
  /** Total links rewritten. */
  links: number;
  failed: { name: string; error: string }[];
}

/** Which notes would change, and by how many links, without touching anything. */
export async function planRewrite(dir: string, renames: NoteRename[], deps: RewriteDeps): Promise<PlannedNote[]> {
  if (renames.length === 0) return [];
  // The index is debounced behind the watcher; make sure it reflects the disk now.
  await deps.vaultIndex.reconcile(dir);
  const candidates = new Set<string>();
  for (const r of renames) for (const n of deps.vaultIndex.backlinks(dir, r.from)) candidates.add(n);

  const plan: PlannedNote[] = [];
  for (const name of [...candidates].sort()) {
    let previous: string;
    try { previous = await deps.readNote(name); } catch { continue; }
    const { content, changed } = rewriteWikilinks(previous, renames);
    if (changed > 0) plan.push({ name, links: changed, content, previous });
  }
  return plan;
}

export async function applyRewrite(dir: string, renames: NoteRename[], deps: RewriteDeps): Promise<RewriteOutcome> {
  const out: RewriteOutcome = { notes: [], links: 0, failed: [] };
  for (const item of await planRewrite(dir, renames, deps)) {
    try {
      await deps.snapshotBefore(item.name, item.previous);
      await deps.writeNote(item.name, item.content);
      out.notes.push(item.name);
      out.links += item.links;
    } catch (err) {
      // One unwritable note must not stop the others; report it.
      out.failed.push({ name: item.name, error: (err as Error).message });
    }
  }
  return out;
}

/** Counts for a confirmation prompt: how many notes and links would change. */
export async function previewRewrite(dir: string, renames: NoteRename[], deps: RewriteDeps): Promise<{ notes: number; links: number }> {
  const plan = await planRewrite(dir, renames, deps);
  return { notes: plan.length, links: plan.reduce((n, p) => n + p.links, 0) };
}
