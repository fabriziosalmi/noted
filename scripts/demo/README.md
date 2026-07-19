# Automated demo → MP4

A choreographed screen recording of the real Noted app, for LinkedIn / release
posts. Playwright drives the built Electron app through the hero flows and
records the window; ffmpeg renders it to a 1080p MP4.

## Requirements

- A **GUI session** (a real, logged-in display). Electron cannot open a window
  in a headless shell, so this cannot run over plain SSH / CI without a virtual
  display.
- `ffmpeg` on `PATH` (`brew install ffmpeg`).
- Playwright is already a dev dependency.

## Run it

```bash
npm run demo          # build + record + render in one go
```

Or step by step:

```bash
npm run build:main && npm run build:preload && vite build
npm run demo:record            # -> scripts/demo/out/demo.webm
npm run demo:render            # -> scripts/demo/out/demo.mp4
npm run demo:render -- --cards # also -> scripts/demo/out/demo-titled.mp4 (title + end card)
```

The recording runs against a **throwaway vault** (a temp dir passed via
`NOTED_NOTES_DIR`), so it never touches your real notes.

## What it shows

1. The capture loop — `⌘N` lands in an empty title; typing it renames the note live.
2. Project cohesion — a second same-project note, accepting the grouping chip.
3. Instant search (`⌘⇧F`) and quick-open (`⌘P`).

## Tweaking

Everything tunable is at the top of [`record.mjs`](record.mjs): pacing
(`TYPE_DELAY`, `BEAT`, `HOLD`), the window `SIZE`, and the demo content
(`NOTE_A_*` / `NOTE_B_*`). Steps are isolated — a selector that misses logs
`[skip]` and the take continues, so you can iterate on one beat at a time.

Card text (title / end) lives in [`render.mjs`](render.mjs).

Outputs land in `scripts/demo/out/` (git-ignored).
