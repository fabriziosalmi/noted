import { chromium } from 'playwright';

const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:8066';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.setDefaultTimeout(7000);

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

const shortcutsHeading = page.getByRole('heading', { name: /keyboard shortcuts|scorciatoie da tastiera/i }).first();
const quickOpenInput = page.getByPlaceholder(/open note|apri nota/i).first();
const findInput = page.getByPlaceholder(/search in document|cerca nel documento/i).first();

await runStep('open app shell', async () => {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.getByText('Noted').first().waitFor({ timeout: 10000 });
});

await runStep('shift+? in contenteditable does not open shortcuts modal', async () => {
  const editor = page.locator('[contenteditable="true"]').first();
  await editor.click();
  await page.keyboard.press('Shift+Slash');
  await page.waitForTimeout(150);
  if (await shortcutsHeading.isVisible()) {
    throw new Error('Shortcuts modal opened from contenteditable Shift+? input');
  }
});

await runStep('shift+? outside editable opens shortcuts modal', async () => {
  await page.getByText('Noted').first().click();
  await page.keyboard.press('Shift+Slash');
  await shortcutsHeading.waitFor({ state: 'visible', timeout: 3000 });
  await page.keyboard.press('Escape');
});

await runStep('AltGr-like ctrl+alt+f does not open find bar', async () => {
  const editor = page.locator('[contenteditable="true"]').first();
  await editor.click();
  await page.keyboard.press('Control+Alt+f');
  await page.waitForTimeout(150);
  if (await findInput.isVisible()) {
    throw new Error('Find bar opened by Ctrl+Alt+F (AltGr-like combo)');
  }
});

await runStep('repeated keydown is ignored for quick-open shortcut', async () => {
  await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'p',
      metaKey: true,
      repeat: true,
      bubbles: true,
    }));
  });
  await page.waitForTimeout(150);
  if (await quickOpenInput.isVisible()) {
    throw new Error('Quick open reacted to repeat=true keydown');
  }
});

await runStep('normal quick-open shortcut still works', async () => {
  await page.keyboard.press('Meta+KeyP').catch(async () => {
    await page.keyboard.press('Control+KeyP');
  });
  await quickOpenInput.waitFor({ state: 'visible', timeout: 3000 });
  await page.keyboard.press('Escape');
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
