import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './fixtures';

// Settings → MCP → Agent access (#86): a policy edited in the app is the file the MCP server enforces.
const policyFile = (vault: string) => path.join(vault, '.noted', 'mcp-policy.yaml');

test('agent access: rules are written to the policy file, an invalid file is shown and can be reset', async ({ noted }) => {
  const { win, vault } = noted;
  await win.getByRole('button', { name: 'Settings' }).click();
  await win.getByRole('tab', { name: 'MCP' }).click();
  const panel = win.getByTestId('agent-access');
  await expect(panel.getByLabel('Everywhere else')).toHaveValue('read-write', { timeout: 15_000 });
  expect(fs.existsSync(policyFile(vault))).toBe(false); // open access is no file at all

  await panel.getByLabel('Everywhere else').selectOption('read-only');
  await panel.getByLabel('Folder', { exact: true }).fill('Private');
  await panel.getByLabel('Agent access', { exact: true }).and(win.locator('select')).selectOption('hidden');
  await panel.getByRole('button', { name: 'Add folder' }).click();
  await panel.getByLabel('Folder', { exact: true }).fill('inbox');
  await panel.getByLabel('Agent access', { exact: true }).and(win.locator('select')).selectOption('read-write');
  await panel.getByRole('button', { name: 'Add folder' }).click();
  await expect(panel.locator('[data-rule]')).toHaveCount(2);

  await expect.poll(() => (fs.existsSync(policyFile(vault)) ? fs.readFileSync(policyFile(vault), 'utf8') : ''), { timeout: 15_000 })
    .toMatch(/^# .*\ndefault: read-only\nfolders:\n {2}inbox: read-write\n {2}private: hidden\n$/);

  // A rule can be removed, and going back to open access removes the file
  await panel.getByRole('button', { name: 'Remove rule for inbox' }).click();
  await expect(panel.locator('[data-rule]')).toHaveCount(1);

  // The file edited by hand into something invalid is not guessed at
  fs.writeFileSync(policyFile(vault), 'default: nope\n');
  await win.getByRole('tab', { name: 'Appearance' }).click();
  await win.getByRole('tab', { name: 'MCP' }).click();
  const alert = win.getByTestId('agent-access').getByRole('alert');
  await expect(alert).toContainText('Assistants can reach nothing until it is fixed', { timeout: 15_000 });
  await alert.getByRole('button', { name: 'Reset to open access' }).click();
  await expect(win.getByTestId('agent-access').getByLabel('Everywhere else')).toHaveValue('read-write');
  await expect.poll(() => fs.existsSync(policyFile(vault)), { timeout: 15_000 }).toBe(false);
});
