#!/usr/bin/env node
// The macOS update feed (latest-mac.yml) can say which systems a release runs on: electron-updater skips an update when
// `minimumSystemVersion` is above the running system. It compares against os.release(), which on macOS is the Darwin
// kernel version, not the macOS one (macOS 13 Ventura is Darwin 22). Without the field, a Mac below the app's minimum
// downloads an update it cannot open.
//
// Usage: node scripts/mac-min-darwin.mjs <LSMinimumSystemVersion>   e.g. 13.0 -> 22.0.0

// Darwin's major follows macOS's: +9 from macOS 11 to 15; macOS 26 (the year numbering) is Darwin 25.
const DARWIN = { 11: 20, 12: 21, 13: 22, 14: 23, 15: 24, 26: 25 };

export function darwinFor(macos) {
  const major = Number(String(macos).split('.')[0]);
  const darwin = DARWIN[major];
  if (darwin === undefined) throw new Error(`no known Darwin version for macOS ${macos}`);
  return `${darwin}.0.0`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    console.log(darwinFor(process.argv[2]));
  } catch (err) {
    console.error(`✗ ${err.message}`);
    process.exit(1);
  }
}
