// Automated demo recorder for Noted.
//
// Launches the built Electron app against a throwaway vault and drives it
// through the hero flows — the perfected capture loop, project cohesion,
// instant search — while Playwright records the window to a .webm. Render it to
// an MP4 with `npm run demo:render`.
//
// Must run in a GUI session (a real display): Electron cannot open a window in a
// headless shell. From the repo root:
//
//   npm run build && npm run demo:record   # produces scripts/demo/out/demo.webm
//   npm run demo:render                     # -> scripts/demo/out/demo.mp4
//
// Everything you'd want to tweak — pacing, the demo script, the window size —
// lives in the constants below.

import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, renameSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { _electron } = require('playwright');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_DIR = join(ROOT, 'scripts', 'demo', 'out');
const SIZE = { width: 1440, height: 900 };

// Pacing (ms). Slow enough to read on LinkedIn, quick enough to stay under ~60s.
const TYPE_DELAY = 55;      // per-keystroke, so typing looks human
const BEAT = 750;           // pause between distinct actions
const HOLD = 1600;          // pause to let a result land on screen

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Neutral demo content — never real client names.
//
// Bodies are several lines rather than one: a note holding a single sentence
// leaves the editor 90% white, which reads as "empty app" in a still frame.
const NOTE_A_TITLE = 'Aurora — Launch Plan';
const NOTE_A_BODY = [
  'Beta ships Friday. Everything below has to be true before we tag it.',
  '- Changelog written and proofread',
  '- Release notes drafted for the blog',
  '- Notarized build verified on a clean machine',
  '- Rollback tested end to end',
];
const NOTE_B_TITLE = 'Aurora — Q3 Notes';
const NOTE_B_BODY = [
  'Weekly sync — metrics up, onboarding polish is next.',
  'Retention held through the migration, so the risk we sized in June never landed.',
];

async function main() {
  const vault = mkdtempSync(join(tmpdir(), 'noted-demo-'));
  mkdirSync(OUT_DIR, { recursive: true });
  console.log('vault:', vault);
  console.log('recording to:', OUT_DIR);

  const app = await _electron.launch({
    args: ['dist-electron/main.cjs'],
    cwd: ROOT,
    env: { ...process.env, NOTED_NOTES_DIR: vault, NODE_ENV: 'production' },
    recordVideo: { dir: OUT_DIR, size: SIZE },
    timeout: 30000,
  });

  const win = await app.firstWindow({ timeout: 20000 });
  await win.waitForLoadState('domcontentloaded');
  await win.setViewportSize(SIZE).catch(() => {});
  await sleep(HOLD);

  // Run a named beat; a failing selector logs and continues so one missed step
  // never aborts the whole take.
  const beat = async (name, fn) => {
    try {
      await fn();
    } catch (e) {
      console.log(`  [skip] ${name}: ${String(e).split('\n')[0]}`);
    }
    await sleep(BEAT);
  };

  const editor = () => win.locator('[contenteditable="true"]').first();

  // Type an array of lines, letting the editor's input rules turn "- " into a
  // real bullet list. Leaves the list at the end (Enter on an empty item would
  // exit it, which we don't need mid-note).
  const typeLines = async (lines) => {
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) await win.keyboard.press('Enter');
      await win.keyboard.type(lines[i], { delay: TYPE_DELAY });
    }
  };

  // 1 — Capture loop: ⌘N lands in an empty title; type it, watch the sidebar
  //     row rename itself live, then flow into the body.
  await beat('new note A', async () => {
    await win.keyboard.press('Meta+KeyN');
    await sleep(BEAT);
    await editor().click();
    await win.keyboard.type(NOTE_A_TITLE, { delay: TYPE_DELAY });
    // The title→filename sync is debounced ~900ms, so pause past it: the point
    // of the beat is watching the sidebar row rename itself.
    await sleep(HOLD);
    await win.keyboard.press('Enter');
    await typeLines(NOTE_A_BODY);
    await sleep(HOLD);
  });

  // 2 — Project cohesion: a second Aurora-named note. If the project-suggestion
  //     chip appears, accept it with Tab.
  await beat('new note B + project suggestion', async () => {
    await win.keyboard.press('Meta+KeyN');
    await sleep(BEAT);
    await editor().click();
    await win.keyboard.type(NOTE_B_TITLE, { delay: TYPE_DELAY });
    await sleep(HOLD);
    // Accept the chip by clicking it, and only if it is actually on screen. A
    // blind Tab here moves focus to the nearest title-bar button when no chip
    // appeared, and the Enter below then *presses* that button — which is how
    // an earlier take ended up recording the History dialog opening by itself.
    const chip = win.locator('button', { hasText: /^Group #/ }).first();
    if (await chip.isVisible().catch(() => false)) {
      await chip.click();
      await sleep(BEAT);
      await editor().click();
      await win.keyboard.press('End');
    }
    await win.keyboard.press('Enter');
    await typeLines(NOTE_B_BODY);
    await sleep(HOLD);
  });

  // 3 — Wikilinks: "[[" opens the suggester over existing notes; accepting one
  //     writes a real link and gives note A a backlink.
  await beat('wikilink to note A', async () => {
    await win.keyboard.press('Enter');
    await win.keyboard.type('Ship checklist lives in [[', { delay: TYPE_DELAY });
    await sleep(HOLD);
    await win.keyboard.type('Launch', { delay: TYPE_DELAY });
    await sleep(HOLD);
    await win.keyboard.press('Enter');
    await sleep(HOLD);
  });

  // 4 — Instant search across the vault.
  await beat('global search', async () => {
    await win.keyboard.press('Meta+Shift+KeyF');
    await sleep(BEAT);
    await win.keyboard.type('aurora', { delay: TYPE_DELAY });
    await sleep(HOLD);
    await win.keyboard.press('Escape');
  });

  // 5 — Quick-open back to the first note. Click the matching row rather than
  //     pressing Enter blind: if the query matched nothing, Enter would land on
  //     the "Create note" row and the take would end on a note nobody asked for.
  await beat('quick open', async () => {
    await win.keyboard.press('Meta+KeyP');
    await sleep(BEAT);
    await win.keyboard.type('launch', { delay: TYPE_DELAY });
    await sleep(HOLD);
    const row = win.locator('button[data-idx]', { hasText: NOTE_A_TITLE }).first();
    const opened = await row.click({ timeout: 4000 }).then(() => true).catch(() => false);
    if (!opened) {
      // Never fall through to a blind Enter: the last row in the list is
      // "Create note", so Enter would end the take on an empty note nobody
      // asked for. Close the palette and leave the note on screen instead.
      console.log('  [skip] quick open: no row matched, closing the palette');
      await win.keyboard.press('Escape');
    }
    await sleep(HOLD);
  });

  // Close on note A with its backlink panel — a full window, not a modal.
  await sleep(HOLD);
  await app.close();

  // Playwright names the video by a hash; give it a stable name.
  const video = win.video();
  if (video) {
    const src = await video.path();
    const dest = join(OUT_DIR, 'demo.webm');
    if (existsSync(dest)) rmSync(dest);
    renameSync(src, dest);
    console.log('DEMO_WEBM:', dest);
  } else {
    console.log('WARN: no video captured');
  }
}

main().catch((e) => {
  console.error('demo record failed:', e);
  process.exit(1);
});
