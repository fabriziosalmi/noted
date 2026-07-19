import { chromium } from 'playwright';

const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:8066';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.setDefaultTimeout(5000);

const consoleErrors = [];
const pageErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => pageErrors.push(String(err)));

const steps = [];
const runStep = async (name, fn) => {
  try {
    await fn();
    steps.push({ name, ok: true });
  } catch (e) {
    steps.push({ name, ok: false, error: String(e) });
  }
};

await runStep('open app shell', async () => {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
  await page.getByText('Noted').first().waitFor({ timeout: 10000 });
});

await runStep('sidebar search typing', async () => {
  const search = page.getByPlaceholder('Search...');
  await search.fill('alpha');
  await search.clear();
});

await runStep('toggle sidebar + ai panel controls', async () => {
  await page.getByRole('button', { name: 'Toggle sidebar' }).click();
  await page.getByRole('button', { name: 'Toggle sidebar' }).click();
  await page.getByRole('button', { name: 'Toggle AI panel' }).click();
  await page.getByRole('button', { name: 'Toggle AI panel' }).click();
});

await runStep('open shortcuts modal and close with escape', async () => {
  await page.getByRole('button', { name: /Shortcuts/i }).click();
  await page.keyboard.press('Escape');
});

await runStep('open settings from sidebar footer and close', async () => {
  const settingsTrigger = page.locator('div[role="button"][tabindex="0"].p-3').first();
  await settingsTrigger.click();
  await page.getByText('Settings').first().waitFor({ timeout: 5000 });
  await page.keyboard.press('Escape');
});

await runStep('new note action does not crash ui', async () => {
  await page.getByRole('button', { name: 'New note', exact: true }).first().click();
  await page.getByText('Noted').first().waitFor({ timeout: 3000 });
});

await browser.close();

const failed = steps.filter((s) => !s.ok);
console.log(JSON.stringify({
  baseUrl,
  steps,
  failedCount: failed.length,
  consoleErrors,
  pageErrors,
}, null, 2));

if (failed.length > 0) process.exit(2);
