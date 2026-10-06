import { ipcMain } from 'electron';
import { getTargetDir } from '../core/paths';
import { fullTextSearchIndex, vaultIndex } from '../core/services';
import { getMainWindow } from '../core/windows';
import { markAppWrite } from '../core/app-writes';
import { saveSnapshot, writeNoteAtomic } from '../core/note-io';
import { setMigrating } from '../core/migrating';
import { withRepoLock } from '../repo-lock';
import { logEvent, newRequestId } from '../structured-log';
import { migrateToHtml, migrateToMarkdown, planMigration, type MigrationDeps, type MigrationProgress, type MigrationResult } from '../migration';
import { dom } from '../core/dom';

async function depsFor(dir: string): Promise<MigrationDeps> {
  return {
    dom: await dom(),
    writeNote: async (name, content) => {
      await writeNoteAtomic(dir, name, content);
      markAppWrite(dir, name); // our own write: not an outside change to announce to the open note
    },
    snapshotBefore: (name, previous) => saveSnapshot(dir, name, previous, { force: true }),
    onProgress: (p: MigrationProgress) => getMainWindow()?.webContents.send('migration-progress', p),
  };
}

/** Run a conversion with the vault closed to every other write, the Git sync paused, and the indexes brought up to date after. */
async function run(dir: string, reqId: string, work: (deps: MigrationDeps) => Promise<MigrationResult>): Promise<MigrationResult> {
  setMigrating(true);
  try {
    const result = await withRepoLock(dir, async () => work(await depsFor(dir)));
    if (result.ok) {
      fullTextSearchIndex.markDirty(dir);
      await vaultIndex.reconcile(dir);
      getMainWindow()?.webContents.send('vault-format-changed');
    }
    logEvent(result.ok ? 'info' : 'warn', 'vault_conversion_end', {
      reqId,
      ok: result.ok,
      ...(result.ok ? { converted: result.converted } : { reason: result.reason }),
    });
    return result;
  } finally {
    setMigrating(false);
  }
}

export function registerMigrationHandlers(): void {
  const fail = (err: unknown) => ({ ok: false as const, reason: (err as Error).message });

  // What converting would do, without touching anything.
  ipcMain.handle('migration-plan', async (_, direction: unknown, syncDir?: string) => {
    try {
      const dir = getTargetDir(syncDir);
      return { success: true, data: await planMigration(dir, await depsFor(dir), direction === 'to-html' ? 'to-html' : 'to-markdown') };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('migration-apply', async (_, opts: { allowLossy?: unknown } | undefined, syncDir?: string) => {
    const reqId = newRequestId('convert');
    try {
      const dir = getTargetDir(syncDir);
      logEvent('info', 'vault_conversion_start', { reqId, direction: 'to-markdown' });
      return await run(dir, reqId, (deps) => migrateToMarkdown(dir, deps, { allowLossy: opts?.allowLossy === true }));
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle('migration-revert', async (_, syncDir?: string) => {
    const reqId = newRequestId('convert');
    try {
      const dir = getTargetDir(syncDir);
      logEvent('info', 'vault_conversion_start', { reqId, direction: 'to-html' });
      return await run(dir, reqId, (deps) => migrateToHtml(dir, deps));
    } catch (err) {
      return fail(err);
    }
  });
}
