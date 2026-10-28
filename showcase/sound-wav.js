// Records the C64 sound player (c64/sound) in VICE: the Dreadnought's music, with each effect played
// once near the end, as a WAV file. VICE runs at its real speed, so it takes as long as the music.
//
//   node showcase/sound-wav.js <path to VICE folder> [--seconds 34]
//
// Writes showcase/out/shmup-music.wav, and from it (from the music's first sound) shmup-music.mp3.
// Needs cc65, VICE and ffmpeg.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const { findVice } = require('../test/vice-lib.js');
const { song, build, runs } = require('../c64/sound/build.js');

const args = process.argv.slice(2), secArg = args.indexOf('--seconds');
const viceDir = args.find((a, i) => !a.startsWith('--') && (secArg < 0 || i !== secArg + 1));
const seconds = secArg >= 0 ? +args[secArg + 1] : 34;
if (!viceDir) { console.error('usage: node showcase/sound-wav.js <VICE folder> [--seconds 34]'); process.exit(2); }

const { exe } = findVice(viceDir);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-wav-'));
// the music, then each effect in turn over its last seconds
const ticks = seconds * 50, inputs = Array(ticks).fill(0);
song.effects.forEach((_, e) => { inputs[ticks - 50 * (song.effects.length - e) - 40] = 1 << e; });
build(dir, { script: runs(inputs) });
const out = path.join(__dirname, 'out', 'shmup-music.wav');
fs.mkdirSync(path.dirname(out), { recursive: true });
try { fs.unlinkSync(out); } catch (e) { /* not there yet */ }
spawnSync(exe, ['-default', '-sound', '-sounddev', 'dump', '-soundarg', path.join(dir, 'sid.dump'), '-soundrecdev', 'wav', '-soundrecarg', out, '+confirmonexit',
  '-autostartprgmode', '1', '-limitcycles', String(Math.round((seconds + 3) * 985248)), '-autostart', path.join(dir, 'sound.prg')], { timeout: (seconds + 60) * 1000 });
fs.rmSync(dir, { recursive: true, force: true });
if (!fs.existsSync(out)) throw new Error('VICE wrote no WAV');
const mp3 = out.replace(/\.wav$/, '.mp3');
const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', out, '-af', 'silenceremove=start_periods=1:start_threshold=-60dB', '-c:a', 'libmp3lame', '-b:a', '192k', mp3]);
if (ff.status) throw new Error('ffmpeg failed: ' + ff.stderr);
console.log(`${path.relative(process.cwd(), out)}: ${(fs.statSync(out).size / 1024).toFixed(0)} KB; ${path.basename(mp3)}: ${(fs.statSync(mp3).size / 1024).toFixed(0)} KB`);
