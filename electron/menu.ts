import { app, Menu, shell } from 'electron';
import { checkForUpdates } from './updater';
import { getMainWindow, openCaptureWindow } from './core/windows';
import { tr } from './core/language';

// A native macOS menu: gives ⌘, Preferences and self-documents the app's
// shortcuts in the menu bar. Custom items relay to the renderer over IPC (the
// menu owns these accelerators, so macOS routes the keystroke here, not to the
// renderer's keydown handler — no double-fire).
export function buildAppMenu() {
  const send = (cmd: string) => getMainWindow()?.webContents.send('menu-command', cmd);
  const isMac = process.platform === 'darwin';
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' as const },
        { label: tr('menuCheckForUpdates'), click: () => void checkForUpdates(() => getMainWindow(), true) },
        { type: 'separator' as const },
        { label: tr('menuPreferences'), accelerator: 'Cmd+,', click: () => send('settings') },
        { type: 'separator' as const },
        { role: 'services' as const },
        { type: 'separator' as const },
        { role: 'hide' as const },
        { role: 'hideOthers' as const },
        { role: 'unhide' as const },
        { type: 'separator' as const },
        { role: 'quit' as const },
      ],
    } as Electron.MenuItemConstructorOptions] : []),
    {
      label: tr('menuFile'),
      submenu: [
        { label: tr('menuNewNote'), accelerator: 'CmdOrCtrl+N', click: () => send('new-note') },
        { label: tr('menuDailyNote'), click: () => send('daily') },
        { label: tr('ingestMenu'), click: () => send('ingest') },
        { label: tr('menuQuickCapture'), click: () => openCaptureWindow() },
        { type: 'separator' as const },
        { label: tr('menuPrint'), accelerator: 'CmdOrCtrl+P', click: () => send('print-note') },
        ...(isMac ? [] : [{ type: 'separator' as const }, { role: 'quit' as const }]),
      ],
    },
    { role: 'editMenu' },
    {
      label: tr('menuView'),
      submenu: [
        { label: tr('menuQuickOpen'), accelerator: 'CmdOrCtrl+K', click: () => send('quick-open') },
        { label: tr('menuSearchAll'), accelerator: 'CmdOrCtrl+Shift+F', click: () => send('search') },
        { type: 'separator' as const },
        { label: tr('menuFocusMode'), accelerator: 'CmdOrCtrl+\\', click: () => send('focus-mode') },
        { label: tr('menuShortcuts'), click: () => send('shortcuts') },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' as const }]),
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help' as const,
      submenu: [
        { label: tr('menuDocumentation'), click: () => void shell.openExternal('https://fabriziosalmi.github.io/noted/') },
        { label: tr('menuReleaseNotes'), click: () => void shell.openExternal('https://github.com/fabriziosalmi/noted/releases') },
        { label: tr('menuReportIssue'), click: () => void shell.openExternal('https://github.com/fabriziosalmi/noted/issues/new') },
        // On macOS this lives in the app menu, where the platform expects it.
        ...(isMac ? [] : [
          { type: 'separator' as const },
          { label: tr('menuCheckForUpdates'), click: () => void checkForUpdates(() => getMainWindow(), true) },
        ]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
