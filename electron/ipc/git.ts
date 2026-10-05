import { ipcMain } from 'electron';
import path from 'node:path';
import { validateFileName } from '../ipc-utils';
import * as gitOps from '../git-ops';
import { sanitizeGitError } from '../git-ops';
import * as gitSync from '../git-sync';
import { logEvent, newRequestId } from '../structured-log';
import { getTargetDir, getActiveVaultDir } from '../core/paths';
import { getMainWindow } from '../core/windows';

export function registerGitHandlers(): void {
  // ─── Git IPC ──────────────────────────────────────────────────────────────────

  ipcMain.handle('git-status', async (_, syncDir?: string) => {
    const dir = getTargetDir(syncDir);
    return gitOps.getStatus(dir);
  });

  ipcMain.handle('git-init', async (_, syncDir?: string) => {
    const dir = getTargetDir(syncDir);
    return gitOps.initRepo(dir);
  });

  ipcMain.handle('git-commit-note', async (_, noteName: string, message: string | undefined, syncDir?: string) => {
    if (!noteName || typeof noteName !== 'string') return { success: false, error: 'Note name required' };
    try { validateFileName(noteName); } catch (e) { return { success: false, error: (e as Error).message }; }
    const dir = getTargetDir(syncDir);
    return gitOps.commitNote(dir, noteName, message);
  });

  ipcMain.handle('git-commit-all', async (_, message: string, syncDir?: string) => {
    if (!message || typeof message !== 'string') return { success: false, error: 'Commit message required' };
    const dir = getTargetDir(syncDir);
    return gitOps.commitAll(dir, message);
  });

  // ─── Git background sync ──────────────────────────────────────────────────────
  // Every state change (syncing / conflict / error / idle) is pushed to the window
  // so the title bar can show it without polling.
  gitSync.setSyncListener((dir, state) => {
    if (dir !== getTargetDir(getActiveVaultDir() || undefined)) return;
    const win = getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send('git-sync-state', state);
  });

  ipcMain.handle('git-sync-now', async (_, syncDir?: string) => {
    const reqId = newRequestId('git-sync');
    const t0 = Date.now();
    logEvent('info', 'git_sync_start', { reqId });
    const state = await gitSync.syncNow(getTargetDir(syncDir));
    logEvent(state.phase === 'error' ? 'warn' : 'info', 'git_sync_end', {
      reqId, phase: state.phase, ms: Date.now() - t0, conflicts: state.conflicts.length,
      message: state.message ? sanitizeGitError(state.message) : null,
    });
    return state;
  });

  ipcMain.handle('git-sync-state', async (_, syncDir?: string) => {
    return gitSync.getSyncState(getTargetDir(syncDir));
  });

  ipcMain.handle('git-sync-resolve', async (_, resolutions: unknown, syncDir?: string) => {
    const parsed = gitSync.parseConflictResolutions(resolutions);
    if (!parsed) return { success: false, error: 'Invalid resolutions.' };
    const reqId = newRequestId('git-resolve');
    const t0 = Date.now();
    logEvent('info', 'git_sync_resolve_start', { reqId, count: parsed.length });
    const result = await gitSync.resolveConflicts(getTargetDir(syncDir), parsed);
    logEvent(result.success ? 'info' : 'warn', 'git_sync_resolve_end', {
      reqId, ok: result.success, ms: Date.now() - t0, error: result.error ? sanitizeGitError(result.error) : null,
    });
    return result;
  });

  ipcMain.handle('git-prepare-pr-branch', async (_, noteName: string, commitMessage: string | undefined, syncDir?: string) => {
    if (!noteName || typeof noteName !== 'string') return { success: false, error: 'Note name required' };
    try { validateFileName(noteName); } catch (e) { return { success: false, error: (e as Error).message }; }
    const dir = getTargetDir(syncDir);
    return gitOps.preparePrBranch(dir, noteName, commitMessage);
  });

  ipcMain.handle('git-push-branch', async (_, branch: string, remoteUrl: string, syncDir?: string) => {
    if (!branch || !remoteUrl) return { success: false, error: 'branch and remoteUrl required' };
    const dir = getTargetDir(syncDir);
    return gitOps.pushBranch(dir, branch, remoteUrl);
  });

  ipcMain.handle('git-log', async (_, noteName: string | undefined, syncDir?: string) => {
    const dir = getTargetDir(syncDir);
    return gitOps.getLog(dir, noteName);
  });

  ipcMain.handle('git-create-pr', async (_, params: {
    remoteUrl: string; token: string; branch: string; base: string; title: string; body: string;
  }) => {
    const reqId = newRequestId('git-pr');
    if (!params || typeof params !== 'object') return { success: false, error: 'Invalid params' };
    const res = await gitOps.createGitHubPr(params);
    logEvent('info', 'git_create_pr_completed', {
      reqId,
      success: !!res.success,
      branch: params.branch,
      base: params.base,
    });
    return res;
  });

  ipcMain.handle('git-save-as-gist', async (_, params: {
    fileName: string; content: string; isPublic: boolean; token: string;
  }) => {
    if (!params?.token) return { success: false, error: 'GitHub token required' };
    if (!params.content) return { success: false, error: 'Content required' };
    const safeName = path.basename(params.fileName || 'note.md');
    const body = JSON.stringify({
      description: safeName.replace(/\.md$/, ''),
      public: !!params.isPublic,
      files: { [safeName]: { content: params.content } },
    });
    try {
      const res = await fetch('https://api.github.com/gists', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${params.token}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body,
      });
      const json = await res.json() as { html_url?: string; message?: string };
      if (!res.ok) return { success: false, error: sanitizeGitError(json.message ?? `HTTP ${res.status}`) };
      return { success: true, data: json.html_url };
    } catch (e) {
      return { success: false, error: sanitizeGitError((e as Error).message) };
    }
  });
}
