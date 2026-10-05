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
});
