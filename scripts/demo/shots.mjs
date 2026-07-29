// Screenshots AND the walkthrough video for the README and the docs site.
//
// Deliberately NOT typed from scratch: driving the real UI through synthetic
// typing makes every frame hostage to a debounce, a suggestion popup, or an
// autosave that lands a beat late (an earlier take literally recorded an error
// toast and a stray History dialog). Instead the content is seeded straight
// onto disk from a shared fixture and the app is only asked to *open* and
// *navigate* it — so titles are always right and the result is the same every
// run.
//
// One launch produces both:
//   - shot-editor.png / shot-search.png / shot-quickopen.png (via screenshot)
//   - demo.webm (the whole session), which render.mjs turns into demo.mp4
//
// Requires a GUI session — Electron cannot open a window in a headless shell.
//
//   npm run build:bundles && npm run demo:shots     # -> out/*.png + out/demo.webm
//   npm run demo:render                             # -> out/demo.mp4

import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NOTES } from './fixture.mjs';

const require = createRequire(import.meta.url);
const { _electron } = require('playwright');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_DIR = join(ROOT, 'scripts', 'demo', 'out');
const SIZE = { width: 1440, height: 900 };

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const vault = mkdtempSync(join(tmpdir(), 'noted-shots-'));
  mkdirSync(OUT_DIR, { recursive: true });
  for (const [name, html] of NOTES) {
    writeFileSync(join(vault, name), html, 'utf-8');
    // Distinct mtimes, so the sidebar's "recently modified" order is stable.
    await sleep(15);
  }
  console.log('vault:', vault);

  // Launch the *package* ('.') rather than the entry file directly: pointed at
  // a bare script, Electron never reads package.json and app.getVersion() falls
  // back to the Electron version — which would put "v42.1.0" in the status bar.
  const app = await _electron.launch({
    args: ['.'],
    cwd: ROOT,
    env: { ...process.env, NOTED_NOTES_DIR: vault, NODE_ENV: 'production' },
    recordVideo: { dir: OUT_DIR, size: SIZE },
    timeout: 30000,
  });

  const win = await app.firstWindow({ timeout: 20000 });
  await win.waitForLoadState('domcontentloaded');
  await win.setViewportSize(SIZE).catch(() => {});
  await sleep(2500);

  const shot = async (name) => {
    const file = join(OUT_DIR, `${name}.png`);
    await win.screenshot({ path: file });
    console.log('SHOT:', file);
  };
  const open = async (title) => {
    // Sidebar rows are divs, not buttons — match on the exact title text.
    await win.getByText(title, { exact: true }).first()
      .click({ timeout: 5000 }).catch(() => console.log(`  [skip] open ${title}`));
  };

  // 1 — The editor on a note with real structure: a task list (two done) and a
  //     wikilink. This is the hero still.
  await open('Aurora — launch plan');
  await sleep(1600);
  await shot('shot-editor');

  // 2 — Wikilink navigation: click the inline link and land on the target note,
  //     which carries a backlink straight back. Video-only beat.
  await win.getByRole('link', { name: 'Aurora — Q3 notes' }).first()
    .click({ timeout: 4000 }).catch(() => console.log('  [skip] wikilink'));
  await sleep(1800);

  // 3 — Full-text search across the vault.
  await win.keyboard.press('Meta+Shift+KeyF');
  await sleep(700);
  await win.keyboard.type('aurora', { delay: 70 });
  await sleep(1600);
  await shot('shot-search');
  await win.keyboard.press('Escape');
  await sleep(700);

  // 4 — Quick open: jump anywhere by name.
  await win.keyboard.press('Meta+KeyP');
  await sleep(700);
  await win.keyboard.type('aur', { delay: 90 });
  await sleep(1500);
  await shot('shot-quickopen');
  await win.keyboard.press('Enter');
  await sleep(1600);

  await app.close();

  // Give the recording a stable name for render.mjs.
  const video = win.video();
  if (video) {
    const src = await video.path();
    const dest = join(OUT_DIR, 'demo.webm');
    if (existsSync(dest)) rmSync(dest);
    const { renameSync } = await import('node:fs');
    renameSync(src, dest);
    console.log('DEMO_WEBM:', dest);
  }
}

main().catch(e => {
  console.error('shots failed:', e);
  process.exit(1);
});
