// Benchmark of whisper.cpp for #80: for each model and each audio file, how long it takes (and so how many times faster than real
// time), how much memory it needs, and how many words it gets wrong. Run it on the machine you want to know about:
//
//   WHISPER_CLI=/path/to/whisper-cli MODELS=/path/to/ggml-models AUDIO=/path/to/audio node bench.mjs [--cpu-only] [--models tiny,base]
//
// AUDIO holds <name>.wav (16 kHz mono) and <name>.txt (what is said in it); the language is the first part of the name (en, it,
// en-long -> en). MODELS holds ggml-<model>.bin. Writes results.json next to this file and prints a table.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wer } from './wer.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = process.env.WHISPER_CLI;
const modelsDir = process.env.MODELS;
const audioDir = process.env.AUDIO;
if (!cli || !modelsDir || !audioDir) { console.error('Set WHISPER_CLI, MODELS and AUDIO (see the top of this file).'); process.exit(2); }
const arg = (name) => { const i = process.argv.indexOf(name); return i === -1 ? null : process.argv[i + 1]; };
const cpuOnly = process.argv.includes('--cpu-only');
const only = arg('--models')?.split(',');

const models = fs.readdirSync(modelsDir).map(f => /^ggml-(.+)\.bin$/.exec(f)?.[1]).filter(m => m && (!only || only.includes(m)));
const order = ['tiny', 'base', 'small', 'small-q5_1', 'medium', 'large-v3-turbo-q5_0'];
models.sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
const clips = fs.readdirSync(audioDir).filter(f => f.endsWith('.wav')).map(f => f.slice(0, -4)).sort();

const seconds = (wav) => Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', wav], { encoding: 'utf8' }).stdout);
const timeArgs = process.platform === 'darwin' ? ['-l'] : process.platform === 'linux' ? ['-v'] : null;
const rss = (stderr) => {
  const mac = /(\d+)\s+maximum resident set size/.exec(stderr);
  if (mac) return Number(mac[1]) / 1048576;
  const linux = /Maximum resident set size \(kbytes\):\s*(\d+)/.exec(stderr);
  return linux ? Number(linux[1]) / 1024 : null;
};

const results = [];
for (const model of models) {
  // The first run of a model pays for loading it from disk and (on GPU) compiling its kernels; measure that once, apart.
  const warm = spawnSync(cli, ['-m', path.join(modelsDir, `ggml-${model}.bin`), '-f', path.join(audioDir, `${clips[0]}.wav`), '-l', clips[0].split('-')[0], ...(cpuOnly ? ['-ng'] : [])], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  void warm;
  for (const clip of clips) {
    const wav = path.join(audioDir, `${clip}.wav`);
    const lang = clip.split('-')[0];
    // Timestamps stay ON: with -nt whisper.cpp decodes long audio as one blind stream and drops most of it (see REPORT.md).
    const args = ['-m', path.join(modelsDir, `ggml-${model}.bin`), '-f', wav, '-l', lang, ...(cpuOnly ? ['-ng'] : [])];
    const started = performance.now();
    const run = timeArgs ? spawnSync('/usr/bin/time', [...timeArgs, cli, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }) : spawnSync(cli, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const wall = (performance.now() - started) / 1000;
    const hypothesis = (run.stdout ?? '').split('\n').map(l => l.replace(/^\[[^\]]*\]/, '')).join(' ');
    const reference = fs.readFileSync(path.join(audioDir, `${clip}.txt`), 'utf8');
    const audio = seconds(wav);
    results.push({
      model, clip, language: lang, audioSeconds: Math.round(audio * 10) / 10, wallSeconds: Math.round(wall * 100) / 100,
      timesRealtime: Math.round((audio / wall) * 10) / 10, peakMemoryMB: rss(run.stderr) === null ? null : Math.round(rss(run.stderr)),
      wer: Math.round(wer(reference, hypothesis) * 1000) / 10, exit: run.status,
    });
    console.log(`${model.padEnd(20)} ${clip.padEnd(8)} ${String(results.at(-1).wallSeconds).padStart(7)} s  ${String(results.at(-1).timesRealtime).padStart(6)}x  ${String(results.at(-1).peakMemoryMB ?? '?').padStart(6)} MB  WER ${results.at(-1).wer}%`);
  }
}

const machine = { cpu: os.cpus()[0]?.model, cores: os.cpus().length, memoryGB: Math.round(os.totalmem() / 1073741824), platform: `${process.platform}/${process.arch}`, gpu: !cpuOnly };
fs.writeFileSync(path.join(here, cpuOnly ? 'results-cpu.json' : 'results.json'), `${JSON.stringify({ machine, whisperCli: cli, results }, null, 2)}\n`);
