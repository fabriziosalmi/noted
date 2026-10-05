import { app, Menu, shell } from 'electron';
import { checkForUpdates } from './updater';
import { getMainWindow, openCaptureWindow } from './core/windows';

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
        { label: 'Check for Updates…', click: () => void checkForUpdates(() => getMainWindow(), true) },
        { type: 'separator' as const },
        { label: 'Preferences…', accelerator: 'Cmd+,', click: () => send('settings') },
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
      label: 'File',
      submenu: [
        { label: 'New Note', accelerator: 'CmdOrCtrl+N', click: () => send('new-note') },
        { label: 'Daily Note', click: () => send('daily') },
        { label: 'Quick Capture', click: () => openCaptureWindow() },
        { type: 'separator' as const },
        { label: 'Print…', accelerator: 'CmdOrCtrl+P', click: () => send('print-note') },
        ...(isMac ? [] : [{ type: 'separator' as const }, { role: 'quit' as const }]),
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Quick Open', accelerator: 'CmdOrCtrl+K', click: () => send('quick-open') },
        { label: 'Search All Notes', accelerator: 'CmdOrCtrl+Shift+F', click: () => send('search') },
        { type: 'separator' as const },
        { label: 'Focus Mode', accelerator: 'CmdOrCtrl+\\', click: () => send('focus-mode') },
        { label: 'Keyboard Shortcuts', click: () => send('shortcuts') },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' as const }]),
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help' as const,
      submenu: [
        { label: 'Documentation', click: () => void shell.openExternal('https://fabriziosalmi.github.io/noted/') },
        { label: 'Release Notes', click: () => void shell.openExternal('https://github.com/fabriziosalmi/noted/releases') },
        { label: 'Report an Issue', click: () => void shell.openExternal('https://github.com/fabriziosalmi/noted/issues/new') },
        // On macOS this lives in the app menu, where the platform expects it.
        ...(isMac ? [] : [
          { type: 'separator' as const },
          { label: 'Check for Updates…', click: () => void checkForUpdates(() => getMainWindow(), true) },
        ]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
