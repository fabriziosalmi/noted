/**
 * An Obsidian vault opened in place (ADR 0001, #62): a folder of Markdown files with a `.obsidian/` folder in
 * it. Noted reads it as it is and never rewrites a file until the user edits that note. The few things worth
 * learning from Obsidian's own settings are read here, read-only. Node only.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { isValidAttachmentsFolder } from './attachmentsFolder';

export const OBSIDIAN_FOLDER = '.obsidian';

export function isObsidianVault(notesDir: string): boolean {
  try {
    return fs.statSync(path.join(notesDir, OBSIDIAN_FOLDER)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Where Obsidian puts pasted files, when that is one fixed folder at the vault's root ("attachments",
 * "Files/"). The other settings (the vault root, the note's own folder, a folder relative to the note) have no
 * equivalent in Noted and give null, so Noted's own setting applies. Never throws.
 */
export function obsidianAttachmentsFolder(notesDir: string): string | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(notesDir, OBSIDIAN_FOLDER, 'app.json'), 'utf8')) as { attachmentFolderPath?: unknown } | null;
    const value = raw?.attachmentFolderPath;
    if (typeof value !== 'string') return null;
    const name = value.replace(/\/+$/, '');
    return isValidAttachmentsFolder(name) ? name : null;
  } catch {
    return null;
  }
}
