/**
 * Every note and folder in a vault, at any depth: the one walk the index, the search, the conversion, the folder
 * tree and the MCP server share, so they list the same notes. Node only.
 *
 * What it will not do, on purpose: follow a symbolic link (a link into another folder, or back up the tree, would be
 * walked forever or leave the vault), enter a hidden folder (`.git`, `.noted`, `.obsidian`, history and trash), list a
 * name `checkNotePath` refuses, or go past the depth and count limits.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { MAX_FOLDER_DEPTH, checkNotePath } from './paths';

export const MAX_WALKED_NOTES = 50_000;
export const MAX_WALKED_FOLDERS = 20_000;

export interface VaultWalk {
  /** Note paths relative to the vault, with "/", sorted. */
  notes: string[];
  /** Folder paths relative to the vault (empty ones too), sorted, parents before children. */
  folders: string[];
  /** A limit was reached: the lists are incomplete. */
  truncated: boolean;
}

export interface WalkOptions {
  maxNotes?: number;
  maxFolders?: number;
}

interface Pending {
  rel: string;
  depth: number;
}

function visit(rel: string, entries: fs.Dirent[], depth: number, out: VaultWalk, stack: Pending[], limits: Required<WalkOptions>): void {
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (depth + 1 > MAX_FOLDER_DEPTH || out.folders.length >= limits.maxFolders) {
        out.truncated = true;
        continue;
      }
      out.folders.push(child);
      stack.push({ rel: child, depth: depth + 1 });
    } else if (entry.isFile() && entry.name.endsWith('.md') && checkNotePath(child) === null) {
      if (out.notes.length >= limits.maxNotes) out.truncated = true;
      else out.notes.push(child);
    }
  }
}

const finish = (out: VaultWalk): VaultWalk => ({ ...out, notes: out.notes.sort(), folders: out.folders.sort() });
const limitsOf = (o: WalkOptions): Required<WalkOptions> => ({ maxNotes: o.maxNotes ?? MAX_WALKED_NOTES, maxFolders: o.maxFolders ?? MAX_WALKED_FOLDERS });

/** An unreadable folder is skipped, not fatal: one bad permission must not hide the rest of the vault. */
export async function walkVault(root: string, options: WalkOptions = {}): Promise<VaultWalk> {
  const limits = limitsOf(options);
  const out: VaultWalk = { notes: [], folders: [], truncated: false };
  const stack: Pending[] = [{ rel: '', depth: 0 }];
  while (stack.length > 0) {
    const { rel, depth } = stack.pop()!;
    let entries: fs.Dirent[];
    try { entries = await fs.promises.readdir(path.join(root, rel), { withFileTypes: true }); } catch { continue; }
    visit(rel, entries, depth, out, stack, limits);
  }
  return finish(out);
}

export function walkVaultSync(root: string, options: WalkOptions = {}): VaultWalk {
  const limits = limitsOf(options);
  const out: VaultWalk = { notes: [], folders: [], truncated: false };
  const stack: Pending[] = [{ rel: '', depth: 0 }];
  while (stack.length > 0) {
    const { rel, depth } = stack.pop()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { continue; }
    visit(rel, entries, depth, out, stack, limits);
  }
  return finish(out);
}
