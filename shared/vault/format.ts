/**
 * Which format a vault's notes are stored in (ADR 0001). Notes written by earlier versions are HTML inside
 * `.md` files; a migrated vault holds Markdown. The answer is a property of the vault, not something to
 * guess per file, and it is kept in a file *inside* the vault so that it travels with the notes: a vault
 * synced to another device (Git, a cloud folder) arrives with its format, whereas `.noted/config.json` is
 * deliberately local. The MCP server reads the same file, so the app and MCP always agree.
 *
 * This file is what the renderer may import; reading and writing the marker is in formatFile.ts (Node only).
 */

export type NoteFormat = 'html' | 'markdown';

export const VAULT_MARKER = '.noted-vault.json';

export const isNoteFormat = (v: unknown): v is NoteFormat => v === 'html' || v === 'markdown';
