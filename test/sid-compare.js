// Compares the SID emulation (core/sid.js) with VICE's: a song and its effects (as showcase/sound-wav.js
// plays them: the music, then each effect, the music off from the first on a voice of its own) are
// rendered through core/sound.js and core/sid.js, and set against VICE's recording of the C64 doing
// the same (showcase/out/<song>-music.wav, from showcase/sound-wav.js). Both are lined up at their
// first sound and cut into 100 ms slices; for each, the loudness (RMS) and the spectrum. It prints how
// closely the loudness follows VICE's over time (correlation), the level difference, and how alike the
// spectra are (mean cosine similarity of 64-band magnitude spectra), and writes the emulation's
// render as showcase/out/<song>-sid.wav to listen to. The emulation is not cycle exact, so this
// measures likeness, not equality.
//
//   node test/sid-compare.js [song] [seconds]      (crypt 58, as recorded by sound-wav.js)
const fs = require('fs'), path = require('path');
const S = require('../core/sound.js'), SID = require('../core/sid.js');

const name = process.argv[2] || 'crypt', seconds = +(process.argv[3] || 58);
const song = S.compile(require(`../sound/${name}.js`));
const vicePath = path.join(__dirname, '..', 'showcase', 'out', `${name}-music.wav`);

// The script sound-wav.js plays: an input per tick (an effect + 1, bit 7 the music off).
const ticks = seconds * 50, inputs = Array(ticks).fill(0);
const quietFrom = song.effects.findIndex(e => e.voice !== song.effectsVoice);
song.effects.forEach((_, e) => { inputs[ticks - 50 * (song.effects.length - e) - 40] = e + 1; });
if (quietFrom >= 0) for (let t = ticks - 50 * (song.effects.length - quietFrom) - 40; t < ticks; t++) inputs[t] |= 128;

// WAV reading and writing (16-bit PCM)
function readWav(file) {
  const b = fs.readFileSync(file);
  let p = 12, fmt = null, data = null;
  while (p < b.length - 8) {
    const id = b.toString('ascii', p, p + 4), len = b.readUInt32LE(p + 4);
    if (id === 'fmt ') fmt = { ch: b.readUInt16LE(p + 10), rate: b.readUInt32LE(p + 12), bits: b.readUInt16LE(p + 22) };
    if (id === 'data') data = b.subarray(p + 8, p + 8 + len);
    p += 8 + len + (len & 1);
  }
  if (!fmt || fmt.bits !== 16) throw new Error(`${file}: not 16-bit PCM`);
  const n = Math.floor(data.length / 2 / fmt.ch), out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = data.readInt16LE(i * 2 * fmt.ch) / 32768;
  return { rate: fmt.rate, samples: out };
}
function writeWav(file, samples, rate) {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + samples.length * 2, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((v, i) => b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), 44 + 2 * i));
  fs.writeFileSync(file, b);
}

const vice = readWav(vicePath), rate = vice.rate;
// the emulation, a frame of samples per tick, at the PAL C64's frame rate (VICE's)
const FPS = SID.CLOCK / (312 * 63);
const chip = SID.create(rate), p = S.player(song), ours = new Float32Array(Math.ceil(ticks * rate / FPS));
let at = 0;
for (let t = 0; t < ticks; t++) {
  const input = inputs[t];
  chip.write(S.tick(song, p, input & 31 ? [(input & 31) - 1] : [], !(input & 128)));
  const end = Math.round(((t + 1) * rate) / FPS);
  chip.render(ours, at, end - at);
  at = end;
}
writeWav(path.join(__dirname, '..', 'showcase', 'out', `${name}-sid.wav`), ours, rate);

// line both up at their first sound
const onset = x => { for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > 0.004) return i; return 0; };
const a = vice.samples.subarray(onset(vice.samples)), b = ours.subarray(onset(ours));
const SLICE = Math.round(rate / 10), N = Math.min(Math.floor(a.length / SLICE), Math.floor(b.length / SLICE)) - 1;
// a slice's 64-band magnitude spectrum (bands spaced evenly up to 8 kHz, by direct DFT on 1024 samples)
function spectrum(x, from) {
  const bands = new Float64Array(64), M = 1024;
  for (let k = 0; k < 64; k++) {
    const f = (k + 0.5) * 8000 / 64;
    let re = 0, im = 0;
    for (let i = 0; i < M; i++) { const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / M), v = x[from + i] * w; re += v * Math.cos((2 * Math.PI * f * i) / rate); im -= v * Math.sin((2 * Math.PI * f * i) / rate); }
    bands[k] = Math.hypot(re, im);
  }
  return bands;
}
const rms = (x, from) => { let s = 0; for (let i = 0; i < SLICE; i++) s += x[from + i] ** 2; return Math.sqrt(s / SLICE); };
const ra = [], rb = [];
let cosSum = 0, cosN = 0;
for (let i = 0; i < N; i++) {
  ra.push(rms(a, i * SLICE)); rb.push(rms(b, i * SLICE));
  if (ra[i] > 0.01 && rb[i] > 0.01) {
    const sa = spectrum(a, i * SLICE), sb = spectrum(b, i * SLICE);
    let d = 0, na = 0, nb = 0;
    for (let k = 0; k < 64; k++) { d += sa[k] * sb[k]; na += sa[k] ** 2; nb += sb[k] ** 2; }
    if (na > 0 && nb > 0) { cosSum += d / Math.sqrt(na * nb); cosN++; }
  }
}
const mean = x => x.reduce((s, v) => s + v, 0) / x.length;
const ma = mean(ra), mb = mean(rb);
let cov = 0, va = 0, vb = 0;
for (let i = 0; i < N; i++) { cov += (ra[i] - ma) * (rb[i] - mb); va += (ra[i] - ma) ** 2; vb += (rb[i] - mb) ** 2; }
const db = x => 20 * Math.log10(x);
console.log(`${name}: ${N} slices of 100 ms`);
console.log(`  loudness over time: correlation ${(cov / Math.sqrt(va * vb)).toFixed(3)}; level ${db(mb).toFixed(1)} dB against VICE's ${db(ma).toFixed(1)} dB`);
console.log(`  spectra: mean similarity ${(cosSum / cosN).toFixed(3)} over ${cosN} slices with sound`);
// the stretches that differ most in loudness (in seconds from the first sound)
const worst = ra.map((v, i) => [i, db(rb[i] + 1e-4) - db(v + 1e-4)]).filter(([i]) => ra[i] > 0.005 || rb[i] > 0.005)
  .sort((x, y) => Math.abs(y[1]) - Math.abs(x[1])).slice(0, 5).map(([i, d]) => `${(i / 10).toFixed(1)}s ${d > 0 ? '+' : ''}${d.toFixed(1)} dB`);
console.log(`  most different: ${worst.join(', ')}`);
console.log(`  showcase/out/${name}-sid.wav`);
