import fs from 'node:fs';
import path from 'node:path';
import { test, expect, SEED_NOTES } from './fixtures';

// The vault health page (#78) on a real vault: it finds what is planted in it, a fix changes the files and the page checks again,
// and the report saved as a note does not disturb the next check.
const DAY = 86_400_000;
const long = (seed: string) => Array.from({ length: 220 }, (_, i) => `${seed}${i}`).join(' ');

test('vault health: finds what is wrong, fixes it with one click, and saves a report that is not part of the next check', async ({ noted }) => {
  for (const [name] of SEED_NOTES) fs.rmSync(path.join(noted.vault, name), { force: true });
  fs.writeFileSync(path.join(noted.vault, '.noted-vault.json'), '{"format":"markdown"}\n');
  const write = (rel: string, text: string, ageDays = 1) => {
    const file = path.join(noted.vault, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    const when = new Date(Date.now() - ageDays * DAY);
    fs.utimesSync(file, when, when);
  };
  write('Hub.md', '# Hub\n\nSee [[Quartely Report]], [[Gone]] and [[Work/Plan#Missing heading]].\n');
  write('Quarterly Report.md', `# Quarterly Report\n\n${long('q')}\n\nBack to [[Hub]].\n`);
  write('Work/Plan.md', '---\nsummary: The plan.\n---\n# Plan\n\n## Goals\n\nShip it, back to [[Hub]].\n');
  write('Alone.md', 'A note about nothing that anyone links to, with a few words in it.\n');
  write('Old.md', 'Written long ago and never touched since, linking to [[Hub]].\n', 800);
  const { win, vault } = await noted.relaunch();

  await win.getByTestId('views-section').getByRole('button', { name: 'Vault health', exact: true }).click({ timeout: 15_000 });
  const page = win.getByTestId('health-page');
  await expect(win.getByTestId('health-summary')).toContainText('5 notes checked', { timeout: 15_000 });
  await expect(win.getByTestId('count-broken-link')).toHaveText('2');
  await expect(win.getByTestId('count-broken-heading')).toHaveText('1');
  await expect(win.getByTestId('count-isolated')).toHaveText('1');
  await expect(win.getByTestId('count-stale')).toHaveText('1');
  await expect(win.getByTestId('count-no-summary')).toHaveText('1');
  const finding = (needle: string) => page.locator('[data-finding]', { hasText: needle });

  // A typo: the link is pointed at the note that was meant, in the file
  await expect(finding('Quartely Report')).toContainText('Did you mean Quarterly Report?');
  await finding('Quartely Report').getByRole('button', { name: 'Use Quarterly Report' }).click();
  await expect(win.getByTestId('count-broken-link')).toHaveText('1', { timeout: 15_000 });
  expect(fs.readFileSync(path.join(vault, 'Hub.md'), 'utf8')).toContain('[[Quarterly Report]]');
  expect(fs.readFileSync(path.join(vault, 'Hub.md'), 'utf8')).not.toContain('Quartely');

  // A link to nothing: the note is made, and the page stays where it is
  await finding('Gone').getByRole('button', { name: 'Create the note' }).click();
  await expect.poll(() => fs.existsSync(path.join(vault, 'Gone.md')), { timeout: 15_000 }).toBe(true);
  await expect(page).toBeVisible();
  await expect(win.getByTestId('count-broken-link')).toHaveCount(0, { timeout: 15_000 });

  // An old note is archived, and the link to it from elsewhere is not left behind
  await finding('Old').getByRole('button', { name: 'Archive' }).click();
  await expect.poll(() => fs.existsSync(path.join(vault, 'Archive', 'Old.md')), { timeout: 15_000 }).toBe(true);
  expect(fs.existsSync(path.join(vault, 'Old.md'))).toBe(false);
  await expect(win.getByTestId('count-stale')).toHaveCount(0, { timeout: 15_000 });

  // Saved as a note in reports/, and opened
  await page.getByRole('button', { name: 'Save as a note' }).click();
  const reportsDir = path.join(vault, 'reports');
  await expect.poll(() => (fs.existsSync(reportsDir) ? fs.readdirSync(reportsDir).length : 0), { timeout: 15_000 }).toBe(1);
  const report = fs.readFileSync(path.join(reportsDir, fs.readdirSync(reportsDir)[0]), 'utf8');
  expect(report).toMatch(/^# Vault health \d{4}-\d{2}-\d{2}/);
  expect(report).toContain('[[Alone]]'); // the isolated note, as a link to open it
  expect(report).toContain('## Links to a missing heading (1)');
  await expect(win.locator('[contenteditable="true"]').first()).toContainText('Vault health');

  // The report is not part of the next check: the note it links to is still isolated, and nothing new is broken
  await win.getByTestId('views-section').getByRole('button', { name: 'Vault health', exact: true }).click();
  await page.getByRole('button', { name: 'Check again' }).click();
  await expect(win.getByTestId('count-isolated')).toHaveText('1', { timeout: 15_000 });
  await expect(win.getByTestId('count-broken-link')).toHaveCount(0);
  await expect(win.getByTestId('health-summary')).toContainText('7 notes checked'); // the six notes and the report
});
