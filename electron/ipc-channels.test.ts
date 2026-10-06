// @vitest-environment node
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// The main process is split across modules; these checks make sure that moving a
// handler never drops, duplicates or renames an IPC channel, whichever file it
// lives in, and that main and preload still agree on every channel and event.

const ELECTRON = path.join(process.cwd(), 'electron');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'test-support' ? [] : sourceFiles(p);
    return /\.ts$/.test(e.name) && !/\.(test|types-check)\.ts$/.test(e.name) ? [p] : [];
  });
}

const main = sourceFiles(ELECTRON).filter(f => path.basename(f) !== 'preload.ts');
const preload = fs.readFileSync(path.join(ELECTRON, 'preload.ts'), 'utf8');
const all = (files: string[], rx: RegExp): string[] =>
  files.flatMap(f => [...fs.readFileSync(f, 'utf8').matchAll(rx)].map(m => m[1]));

const registered = all(main, /ipcMain\.(?:handle|on|once)\(\s*'([a-z0-9-]+)'/g).sort();
const invoked = [...preload.matchAll(/ipcRenderer\.(?:invoke|send|sendSync)\(\s*'([a-z0-9-]+)'/g)].map(m => m[1]).sort();
const listened = [...preload.matchAll(/ipcRenderer\.on\(\s*'([a-z0-9-]+)'/g)].map(m => m[1]).sort();
const pushed = [...new Set(all(main, /webContents\.send\(\s*'([a-z0-9-]+)'/g))].sort();

// Registered with no preload entry on purpose.
const INTERNAL = ['ping'];

describe('IPC channels', () => {
  it('registers each channel exactly once', () => {
    const dup = registered.filter((c, i) => registered.indexOf(c) !== i);
    expect(dup).toEqual([]);
  });

  it('has a handler for every channel the preload invokes, and the reverse', () => {
    expect(invoked.filter(c => !registered.includes(c))).toEqual([]);
    expect(registered.filter(c => !invoked.includes(c) && !INTERNAL.includes(c))).toEqual([]);
  });

  it('pushes every event the preload listens for', () => {
    expect(listened.filter(c => !pushed.includes(c))).toEqual([]);
  });

  // update-download-progress and app-will-quit-for-update are sent by the updater
  // and have no listener in the preload today; pinned so that stays visible.
  it('pushes the expected set of events', () => {
    expect(pushed).toEqual([
      'app-will-quit-for-update', 'flush-before-quit', 'git-sync-state', 'menu-command',
      'migration-progress', 'native-theme-updated', 'note-changed-externally', 'refresh-notes',
      'update-download-progress', 'vault-format-changed', 'vault-index-delta',
    ]);
  });

  // The full list, as of the split of electron/main.ts: a change here is a
  // deliberate API change, never a side effect of moving code.
  it('registers the expected set of channels', () => {
    expect(registered).toEqual([
    'activate-cloud-provider',
    'close-capture',
    'copy-vault-to-folder',
    'create-folder',
    'delete-attachments',
    'delete-folder',
    'delete-note',
    'detect-cloud-providers',
    'export-docx',
    'export-html',
    'export-markdown',
    'export-pdf',
    'get-api-key',
    'get-app-version',
    'get-icloud-path',
    'get-mcp-server-path',
    'get-mcp-sse-token',
    'get-native-theme',
    'get-note-history',
    'get-notes-list',
    'get-notes-tree',
    'get-vault-format',
    'git-commit-all',
    'git-commit-note',
    'git-commit-staged',
    'git-create-pr',
    'git-file-diff',
    'git-get-token',
    'git-init',
    'git-log',
    'git-prepare-pr-branch',
    'git-push-branch',
    'git-save-as-gist',
    'git-stage',
    'git-status',
    'git-store-token',
    'git-sync-now',
    'git-sync-resolve',
    'git-sync-state',
    'git-unstage',
    'import-apple-notes',
    'import-vault',
    'inline-vault-images',
    'list-orphan-attachments',
    'llm-fetch',
    'migrate-embedded-images',
    'migration-apply',
    'migration-plan',
    'migration-revert',
    'move-note',
    'ping',
    'preview-link-rewrite',
    'print-note',
    'rag-candidates',
    'read-note',
    'read-note-snapshot',
    'rename-folder',
    'rename-note',
    'renderer-flushed',
    'reveal-in-finder',
    'rewrite-links',
    'safe-storage-status',
    'save-attachment',
    'save-capture',
    'save-note',
    'scan-embedded-images',
    'search-notes-fulltext',
    'select-sync-folder',
    'set-active-vault-dir',
    'set-llm-hosts',
    'set-note-title',
    'set-vault-config',
    'setup-claude-mcp',
    'share-note-macos',
    'store-api-key',
    'update-mcp-sse-config',
    'vault-index-note',
    'vault-index-snapshot',
    'wipe-all-notes',
    ]);
  });
});
