import { test, expect } from './fixtures';

// Languages other than English are separate chunks, fetched over app:// under the
// production CSP the first time they are needed.
test.describe('interface language', () => {
  test('switching language loads it on demand, and the choice survives a restart', async ({ noted }) => {
    const { win } = noted;

    await win.getByRole('button', { name: 'Settings' }).click();
    await win.getByRole('tab', { name: 'Appearance' }).click();
    const select = win.getByRole('combobox', { name: 'Language' });
    await select.selectOption('it');

    // The dialog and its labels switch to Italian.
    await expect(win.getByRole('combobox', { name: 'Lingua' })).toBeVisible({ timeout: 15_000 });
    await expect(win.getByText('Language', { exact: true })).toHaveCount(0);

    // Quit and relaunch on the same profile: still Italian.
    await win.keyboard.press('Escape');
    const again = await noted.relaunch();
    await expect(again.win.getByRole('button', { name: 'Impostazioni' })).toBeVisible({ timeout: 15_000 });
    await expect(again.win.getByRole('button', { name: 'Settings' })).toHaveCount(0);
  });

  test('the native menu follows it, live and after a restart, before the window has loaded anything', async ({ noted }) => {
    const { win, app } = noted;
    const menuLabels = (a: typeof app) => a.evaluate(({ Menu }) => {
      const top = Menu.getApplicationMenu()!.items;
      const file = top.find(i => i.submenu?.items.some(s => s.accelerator === 'CmdOrCtrl+N'))!;
      return { file: file.label, items: file.submenu!.items.map(i => i.label).filter(Boolean) };
    });
    const english = await menuLabels(app);
    expect(english.file).toBe('File');
    expect(english.items.slice(0, 5)).toEqual(['New Note', 'Daily Note', 'Note from a web page or text…', 'Quick Capture', 'Print…']); // Windows and Linux add the OS's own Quit after these

    await win.getByRole('button', { name: 'Settings' }).click();
    await win.getByRole('tab', { name: 'Appearance' }).click();
    await win.getByRole('combobox', { name: 'Language' }).selectOption('it');
    await expect.poll(() => menuLabels(app).then(m => m.items.slice(0, 4)), { timeout: 15_000 }).toEqual(['Nuova nota', 'Nota del giorno', 'Nota da una pagina web o da un testo…', 'Cattura rapida']);

    // Main remembers it: the next start builds the menu in Italian straight away.
    const again = await noted.relaunch();
    expect((await menuLabels(again.app)).items.slice(0, 4)).toEqual(['Nuova nota', 'Nota del giorno', 'Nota da una pagina web o da un testo…', 'Cattura rapida']);
  });
});

