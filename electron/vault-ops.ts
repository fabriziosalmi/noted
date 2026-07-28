import fs from 'node:fs';
import path from 'node:path';

/**
 * Folder-level vault operations that move files around.
 *
 * These live outside main.ts so they can be exercised against a real temp
 * directory in tests — the IPC handlers themselves are only reachable inside a
 * running Electron process, which is exactly how a silent-overwrite bug used to
 * survive here (see deleteFolderMovingContentToRoot).
 */

/** Media that lives next to notes and must survive a folder delete. */
const MEDIA_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.pdf'];

export function isNoteOrMedia(fileName: string): boolean {
  const ext = path.extname(fileName).toLowerCase();
  return ext === '.md' || MEDIA_EXTENSIONS.includes(ext);
}

/**
 * Pick a name that doesn't exist in `dir` yet, disambiguating with the folder
 * the entry came from: "Note.md" → "Note (Archive).md" → "Note (Archive) 2.md".
 *
 * `exists` is injected so the caller decides what "taken" means (on disk, plus
 * any name already claimed earlier in the same batch).
 */
export function uniqueNameInDir(
  baseName: string,
  fromFolder: string,
  exists: (name: string) => boolean,
): string {
  if (!exists(baseName)) return baseName;
  const ext = path.extname(baseName);
  const stem = ext ? baseName.slice(0, -ext.length) : baseName;
  const tagged = `${stem} (${fromFolder})${ext}`;
  if (!exists(tagged)) return tagged;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${stem} (${fromFolder}) ${n}${ext}`;
    if (!exists(candidate)) return candidate;
  }
  throw new Error(`Could not find a free name for "${baseName}"`);
}

export interface DeleteFolderResult {
  /** Entries moved out to the vault root. */
  moved: number;
  /** "old name → new name" for every entry renamed to avoid a collision. */
  renamed: string[];
}

/**
 * Delete a folder after moving everything it holds to the vault root.
 *
 * Every entry is moved, never overwritten: a root note sharing a name with a
 * note in the folder used to be destroyed by `fs.renameSync` (which replaces
 * the destination silently), with no trash copy and no user-visible warning.
 * Names that collide are disambiguated instead.
 *
 * `resolve` is main's `safeResolve`, injected so destinations still get the
 * symlink-escape check.
 */
export function deleteFolderMovingContentToRoot(
  targetDir: string,
  folderName: string,
  resolve: (dir: string, relName: string) => string,
): DeleteFolderResult {
  const folderPath = resolve(targetDir, folderName);
  const result: DeleteFolderResult = { moved: 0, renamed: [] };

  // Names claimed during this batch, so two entries can't both win the same
  // free name (existsSync alone can't see a move that hasn't happened yet).
  const claimed = new Set<string>();
  const isTaken = (name: string) => claimed.has(name) || fs.existsSync(path.join(targetDir, name));

  for (const entry of fs.readdirSync(folderPath, { withFileTypes: true })) {
    // Leave OS cruft (.DS_Store) behind — the recursive remove below clears it.
    if (entry.name.startsWith('.')) continue;
    if (entry.isFile() && !isNoteOrMedia(entry.name)) continue;

    const destName = uniqueNameInDir(entry.name, folderName, isTaken);
    claimed.add(destName);
    fs.renameSync(path.join(folderPath, entry.name), resolve(targetDir, destName));
    result.moved++;
    if (destName !== entry.name) result.renamed.push(`${entry.name} → ${destName}`);

    // Carry the note's version history across, the way a rename does — the
    // history of a note in a folder lives under ".noted_history/<folder>/<note>".
    if (entry.isFile() && entry.name.endsWith('.md')) {
      const oldHist = path.join(targetDir, '.noted_history', folderName, entry.name);
      const newHist = path.join(targetDir, '.noted_history', destName);
      if (fs.existsSync(oldHist) && !fs.existsSync(newHist)) {
        try {
          fs.mkdirSync(path.dirname(newHist), { recursive: true });
          fs.renameSync(oldHist, newHist);
        } catch { /* history move is best-effort */ }
      }
    }
  }

  // Everything worth keeping is out; drop the folder and whatever dot-files or
  // unsupported files it still holds. rmdirSync would fail on those instead.
  fs.rmSync(folderPath, { recursive: true, force: true });
  // The folder's history bucket is now empty (or orphaned) — clear it too.
  fs.rmSync(path.join(targetDir, '.noted_history', folderName), { recursive: true, force: true });

  return result;
}
