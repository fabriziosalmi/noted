# Spike: local speech-to-text (#80)

Can Noted turn a voice recording into a note without a byte leaving the machine, and which model is light enough to ship? This is
only a spike: it measures and recommends, it adds no feature. The answer is in [REPORT.md](REPORT.md).

## What is here

| File | What it does |
| --- | --- |
| `bench.mjs` | Runs `whisper-cli` (whisper.cpp) over every model and clip: wall time, times faster than real time, peak memory, word error rate. `--cpu-only` turns the GPU off. |
| `vosk-bench.mjs`, `vosk-run.py` | The same measurements for Vosk small models, the lighter non-Whisper candidate. |
| `wer.mjs` | Word error rate (case and punctuation are not held against a transcript). |
| `results.json`, `results-cpu.json`, `results-vosk.json` | The numbers the report quotes. |

## Reproduce

```sh
# 1. whisper.cpp and models (any recent build; this run used d1be6fd with Metal)
git clone https://github.com/ggml-org/whisper.cpp && cd whisper.cpp
cmake -B build && cmake --build build -j --config Release
for m in tiny base small small-q5_1 medium large-v3-turbo-q5_0; do sh models/download-ggml-model.sh $m; done

# 2. test audio: a <name>.wav (16 kHz mono) and a <name>.txt with what is said, name = <language>[-suffix]
#    This run: en and it were read by the macOS `say` voices (about 55 s each); en-long is en repeated 11 times (10 min).

# 3. benchmark
WHISPER_CLI=whisper.cpp/build/bin/whisper-cli MODELS=whisper.cpp/models AUDIO=./audio node bench.mjs
WHISPER_CLI=... MODELS=... AUDIO=... node bench.mjs --cpu-only
```
