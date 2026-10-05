import { app, ipcMain, nativeTheme, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { getMainWindow } from '../core/windows';
import { resolveAppVersion } from '../app-version';

export function registerAppHandlers(): void {
  // Example IPC handler for the magical stuff
  ipcMain.handle('ping', () => 'pong');
  ipcMain.handle('get-app-version', () => resolveAppVersion({
    isPackaged: app.isPackaged,
    electronReported: app.getVersion(),
    packageJsonPath: path.join(__dirname, '../package.json'),
  }));

  ipcMain.handle('reveal-in-finder', (_, fsPath: string) => {
    if (typeof fsPath !== 'string') return { success: false };
    shell.showItemInFolder(fsPath);
    return { success: true };
  });

  ipcMain.handle('get-native-theme', () => ({
    isDark: nativeTheme.shouldUseDarkColors,
  }));

  ipcMain.handle('share-note-macos', async (_, args: { content: string; title: string }) => {
    try {
      const { exec } = await import('node:child_process');
      const os = await import('node:os');
      const safeName = (args.title || 'note').replace(/[^a-zA-Z0-9\-_ ]/g, '_');
      const tempFile = path.join(os.tmpdir(), `${safeName}.md`);
      fs.writeFileSync(tempFile, args.content ?? '', 'utf-8');

      const script = [
        'use framework "AppKit"',
        'use scripting additions',
        `set theURL to current application's NSURL's fileURLWithPath:"${tempFile.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`,
        "set picker to current application's NSSharingServicePicker's alloc()'s initWithItems:{theURL}",
        "set v to current application's NSApp's keyWindow()'s contentView()",
        "picker's showRelativeTo:(current application's NSMakeRect(0, 0, 1, 1)) ofView:v preferredEdge:2",
      ].join('\n');

      const scriptFile = path.join(os.tmpdir(), 'noted-share.applescript');
      fs.writeFileSync(scriptFile, script, 'utf-8');

      return new Promise<{ success: boolean; fallback?: boolean; error?: string }>((resolve) => {
        exec(`osascript "${scriptFile}"`, (err) => {
          if (err) {
            shell.showItemInFolder(tempFile);
            resolve({ success: true, fallback: true });
          } else {
            resolve({ success: true });
          }
        });
      });
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('set-note-title', (_, noteName: string) => {
    const win = getMainWindow();
    if (!win) return;
    const title = noteName ? `${noteName.replace(/\.md$/, '')} — Noted` : 'Noted';
    win.setTitle(title);
  });
}
