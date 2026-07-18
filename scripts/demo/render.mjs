// Render the recorded demo (scripts/demo/out/demo.webm) into a LinkedIn-ready
// MP4: 1920x1080, letterboxed, 30fps, H.264, faststart. Pass `--cards` to also
// emit demo-titled.mp4 with a title + end card.
//
//   npm run demo:render            # -> out/demo.mp4
//   npm run demo:render -- --cards # -> out/demo.mp4 and out/demo-titled.mp4

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'out');
const WEBM = join(OUT_DIR, 'demo.webm');
const MP4 = join(OUT_DIR, 'demo.mp4');
const BG = '0x0B0B12';
const CANVAS = '1920x1080';
const FIT = `scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=${BG},fps=30,format=yuv420p`;

const FONTS = [
  '/System/Library/Fonts/Helvetica.ttc',
  '/System/Library/Fonts/Supplemental/Arial.ttf',
  '/Library/Fonts/Arial.ttf',
];

function ff(args, label) {
  const r = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${label}`);
}

if (!existsSync(WEBM)) {
  console.error(`No recording at ${WEBM}. Run "npm run demo:record" first (needs a GUI session).`);
  process.exit(1);
}

// Core deliverable: normalized MP4.
ff(['-i', WEBM, '-vf', FIT, '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-movflags', '+faststart', '-an', MP4], 'convert');
console.log('DEMO_MP4:', MP4);

if (process.argv.includes('--cards')) {
  // Title/end cards need ffmpeg's drawtext (libfreetype) + a system font. Both
  // are optional: if either is missing, skip the titled variant — demo.mp4 is
  // already the deliverable.
  const font = FONTS.find(existsSync);
  const filters = spawnSync('ffmpeg', ['-hide_banner', '-filters'], { encoding: 'utf8' }).stdout || '';
  const hasDrawtext = /\bdrawtext\b/.test(filters);
  if (!font || !hasDrawtext) {
    const why = !hasDrawtext ? 'this ffmpeg has no drawtext filter (build with libfreetype)' : 'no system font found';
    console.log(`Skipping title cards — ${why}. demo.mp4 is ready.`);
    process.exit(0);
  }

  try {
    const esc = (p) => p.replace(/:/g, '\\:');
    const card = (out, title, subtitle) =>
      ff([
        '-f', 'lavfi', '-i', `color=c=${BG}:s=${CANVAS}:d=2.4`,
        '-vf',
        `drawtext=fontfile=${esc(font)}:text='${title}':fontcolor=white:fontsize=132:x=(w-tw)/2:y=(h-th)/2-70,` +
        `drawtext=fontfile=${esc(font)}:text='${subtitle}':fontcolor=0x9CA3FF:fontsize=52:x=(w-tw)/2:y=(h-th)/2+90`,
        '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-r', '30', out,
      ], `card ${out}`);

    const titleCard = join(OUT_DIR, 'card-title.mp4');
    const endCard = join(OUT_DIR, 'card-end.mp4');
    card(titleCard, 'Noted', 'local-first notes, supercharged');
    card(endCard, 'Noted', 'free and open source');

    // concat filter (re-encode) — robust to per-segment parameter differences.
    const titled = join(OUT_DIR, 'demo-titled.mp4');
    ff([
      '-i', titleCard, '-i', MP4, '-i', endCard,
      '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]',
      '-map', '[v]', '-c:v', 'libx264', '-crf', '20', '-preset', 'medium',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', titled,
    ], 'concat');
    console.log('DEMO_TITLED_MP4:', titled);
  } catch (e) {
    console.log(`Card step skipped: ${String(e).split('\n')[0]} — demo.mp4 is ready.`);
  }
}
