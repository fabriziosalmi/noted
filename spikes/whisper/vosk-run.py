import sys, json, time, wave, resource, vosk
vosk.SetLogLevel(-1)
model, wav = sys.argv[1], sys.argv[2]
t0 = time.time(); m = vosk.Model(model); load = time.time() - t0
w = wave.open(wav, 'rb'); r = vosk.KaldiRecognizer(m, w.getframerate())
dur = w.getnframes() / w.getframerate(); out = []; t0 = time.time()
while True:
    d = w.readframes(8000)
    if not d: break
    if r.AcceptWaveform(d): out.append(json.loads(r.Result())['text'])
out.append(json.loads(r.FinalResult())['text']); run = time.time() - t0
print(json.dumps({'text': ' '.join(out), 'audio': dur, 'load': load, 'run': run, 'rssMB': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1048576}))
