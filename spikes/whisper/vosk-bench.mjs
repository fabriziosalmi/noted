// The same measurements for Vosk (Kaldi) small models, the lighter non-Whisper candidate in #80.
//   VOSK_PYTHON=/path/to/python-with-vosk VOSK_MODELS=/dir/with/vosk-model-small-* AUDIO=/path/to/audio node vosk-bench.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { wer } from './wer.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { VOSK_PYTHON: python, VOSK_MODELS: models, AUDIO: audio } = process.env;
if (!python || !models || !audio) { console.error('Set VOSK_PYTHON, VOSK_MODELS and AUDIO.'); process.exit(2); }
const runs = [['vosk-model-small-en-us-0.15', 'en'], ['vosk-model-small-en-us-0.15', 'en-long'], ['vosk-model-small-it-0.22', 'it']];
const results = runs.map(([model, clip]) => {
  const r = spawnSync(python, [path.join(here, 'vosk-run.py'), path.join(models, model), path.join(audio, `${clip}.wav`)], { encoding: 'utf8' });
  const j = JSON.parse(r.stdout.trim().split('\n').pop());
  const row = { model, clip, audioSeconds: Math.round(j.audio * 10) / 10, loadSeconds: Math.round(j.load * 100) / 100, wallSeconds: Math.round(j.run * 100) / 100,
    timesRealtime: Math.round(j.audio / j.run), peakMemoryMB: Math.round(j.rssMB), wer: Math.round(wer(fs.readFileSync(path.join(audio, `${clip}.txt`), 'utf8'), j.text) * 1000) / 10 };
  console.log(row);
  return row;
});
fs.writeFileSync(path.join(here, 'results-vosk.json'), `${JSON.stringify({ results }, null, 2)}\n`);
