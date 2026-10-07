# Local speech-to-text: report (#80)

**Recommendation: GO, with Whisper `base` as the default model.** It is the lightest model that is accurate enough here (141 MB on
disk, about 0.4-0.6 GB of memory, 20-55 times faster than real time) and Whisper's other sizes are optional downloads. A
non-Whisper engine (Vosk) is lighter on disk but is not a better choice to ship; see "Lighter than Whisper".

## What was measured, and on what

- Apple M4 (arm64), 16 GB, macOS 26. whisper.cpp `d1be6fd`, Metal on (`results.json`) and off (`results-cpu.json`).
- Three clips: English (54 s), Italian (61 s), English long (10 min, the English clip repeated 11 times). The transcripts are known,
  so the word error rate (WER) is exact. A first, discarded run of every model is not counted: it pays for loading the model and
  compiling GPU kernels (one cold start took 12 s for `tiny`).
- **The audio is synthetic.** It was read by the macOS `say` voices: clean, evenly paced, no noise, no accent. Real recordings
  (a phone on a table, two people talking over each other, a thick accent) will do worse, for every model. Treat the WERs as a
  floor and the speeds as the part that carries over.

## Results (GPU on; times faster than real time, higher is better)

| Model | Disk | EN speed | IT speed | Peak memory | WER en / en-long / it |
| --- | --- | --- | --- | --- | --- |
| tiny | 74 MB | 54x | 57x | 0.3-0.4 GB | 2.2% / 1.7% / 14.3% |
| **base** | **141 MB** | **54x** | **40x** | **0.4-0.5 GB** | **0.6% / 1.1% / 9.1%** |
| small-q5_1 | 181 MB | 28x | 16x | 0.55-0.65 GB | 1.1% / 1.1% / 7.4% |
| small | 465 MB | 24x | 16x | 0.8-0.9 GB | 1.1% / 1.1% / 6.9% |
| large-v3-turbo-q5_0 | 547 MB | 17x | 11x | 0.8-0.95 GB | 0.6% / 0.6% / 2.3% |
| medium | 1462 MB | 7.5x | 6.9x | 2.1 GB | 0.6% / 0.6% / 2.3% |

CPU only (no GPU, the case for most Windows and Linux machines): `base` runs 29x (EN) and 10x (IT) real time, `small-q5_1` 8x and 7x,
`large-v3-turbo-q5_0` 6x and 5x, `medium` 2-3x. A one-hour meeting is about 6 minutes with `base` or 12 with `small-q5_1` on a
modern CPU; slower on older ones, which this spike could not measure.

Reading it:

- Quantising `small` (q5_1) costs nothing measurable here (same WER, 60% smaller memory, faster).
- Italian is where size matters: `tiny` mishears one word in seven, `base` one in eleven, the turbo model one in forty. English is
  fine from `base` up.
- On CPU, `base` once degraded on the 10-minute clip (10.7% WER against 1.1% on GPU) while every larger model stayed stable. One
  run, not repeated enough to call it a pattern, but it says "do not ship `tiny`/`base` without a check that the transcript is not
  suspiciously short".

## Two things that would have bitten the feature

1. **Never decode without timestamps.** `whisper-cli -nt` on the 10-minute clip returned 671 of 1969 words (identically on every
   run) with the model that gets 0.6% WER otherwise; the same model without `-nt` returned all 1969. A first benchmark pass used
   `-nt` and produced nonsense WERs (50-66%) that looked like model quality. Whatever code calls whisper must keep timestamps on
   (which a note wants anyway: "at 12:40").
2. **Whisper wants 16 kHz mono PCM.** Recordings arrive as m4a/mp3/webm. Decoding in the renderer with Web Audio and resampling to
   16 kHz avoids shipping ffmpeg; this spike used ffmpeg only to build the test audio.

## Lighter than Whisper

Asked for after the first numbers: is there something lighter than Whisper? Vosk (Kaldi) small models, Apache-2.0:

| Model | Disk | Speed | Peak memory | WER |
| --- | --- | --- | --- | --- |
| vosk-model-small-en-us-0.15 | 68 MB | 10x (en), 36x (en-long) | 0.2-0.27 GB | 7.3% (en), 6.4% (en-long) |
| vosk-model-small-it-0.22 | 87 MB | 18x | 0.23 GB | 4.0% |

Half the memory of `base`, and better on this Italian clip (4.0% against 9.1%). It is still not the one to ship:

- The output is a bare stream of lower-case words: no punctuation, no capitals, no timestamps unless asked for. A note made of
  that needs another model to punctuate it, which is more weight than it saves.
- On disk it is not smaller than `base` (68 and 87 MB per language against 141 MB for all languages), and it needs one model per
  language, chosen by the user, where Whisper detects the language.
- The Node binding (`vosk`, 85 MB, ffi-based) is not maintained for current Electron; the maintained route is `sherpa-onnx-node`
  (prebuilt for mac/win/linux, Apache-2.0), which I did not benchmark. Its catalogue has other light models (Moonshine tiny/base
  int8 at 102/239 MB, English only; NeMo fast-conformer multilingual int8, 97 MB, includes Italian) that are worth a follow-up
  if `base` proves too heavy in practice. Not measured here.
- Clean synthetic speech is the easy case; small Kaldi models are known to lose more than Whisper on noisy, accented real speech, so
  the 4.0% is the least trustworthy number in this report.

If "lighter" means lighter on the user's machine, `base` (or `tiny` for English-only) is the answer within Whisper; I would not
trade punctuation and language detection for 70 MB.

## How it would ship

Two routes, neither built here:

1. **Spawn a bundled `whisper-cli`** (built in CI per platform, shipped as an extra resource, about 1-3 MB). Crash isolation (a
   bad file kills a child, not the app), no native-ABI coupling to Electron, trivial to cancel. Needs a CI job per OS and arch.
2. **`@fugood/whisper.node`** (MIT): prebuilt binaries per platform as optional dependencies (3-8 MB each, CPU, CUDA and Vulkan
   variants), no compiler in CI. It is at `1.2.0-rc.1` and loads in the main process; I would not take a release-candidate native
   addon into the signed app for a first version. `nodejs-whisper` compiles at install time and is out.

Models are **not bundled**: an on-demand download (default `base`, 141 MB) into the app data directory, checked against a pinned
SHA-256, behind an explicit button, the same way embeddings models are an opt-in. The licences are clean: whisper.cpp MIT, OpenAI
Whisper weights MIT.

## What this spike did not establish

- Windows and Linux: nothing was run there, and x64 was not measured at all (this is an M4). CPU-only numbers on the M4 are
  faster than a typical x64 laptop; halve them as a starting guess, then measure on #33's hardware.
- Real speech. See above.
- Live transcription while recording (this measured files), speaker separation, and long-recording memory beyond 10 minutes.
- Whether `base` is "good enough" for Fab's own voice notes. That takes ten real recordings, not more engineering.

## Proposed next steps (if go)

1. Issue: voice note to note: record or import audio, transcribe locally with `base` (opt-in download), keep timestamps, put the
   transcript in a note linked to the audio file. Reuses the ingest/summary flow (#79).
2. Before building: ten real recordings (Italian and English, a phone, a laptop mic, a noisy room) through `bench.mjs` to confirm
   `base` is enough, or that `small-q5_1` is the floor.
