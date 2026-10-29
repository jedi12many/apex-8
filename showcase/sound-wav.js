// Records the C64 sound player (c64/sound) in VICE: a song's music, with each effect played once near
// the end (the music off from the first that plays on a voice of its own, as in a boss fight), as a
// WAV file. VICE runs at its real speed, so it takes as long as the music.
//
//   node showcase/sound-wav.js <path to VICE folder> [--song shmup] [--seconds 34] [--sids 2]
//
// Writes showcase/out/<song>-music.wav, and from it (from the music's first sound) <song>-music.mp3.
// With --sids 2 VICE has a second SID at $D420 (as a C64 Ultimate can), the effects play on it over
// the music, and the files are <song>-music-2sid.*, in stereo as VICE mixes them.
// Needs cc65, VICE and ffmpeg.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const { findVice } = require('../test/vice-lib.js');
const { songOf, build, runs } = require('../c64/sound/build.js');

const args = process.argv.slice(2), opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const viceDir = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const name = opt('--song') || 'shmup', seconds = +(opt('--seconds') || 34), sids = +(opt('--sids') || 1), song = songOf(name);
if (!viceDir) { console.error('usage: node showcase/sound-wav.js <VICE folder> [--song shmup] [--seconds 34]'); process.exit(2); }

const { exe } = findVice(viceDir);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-wav-'));
// the music, then each effect in turn over its last seconds (an input: the effect + 1, bit 7 the music off)
const ticks = seconds * 50, inputs = Array(ticks).fill(0);
const quietFrom = song.effects.findIndex(e => e.voice !== song.effectsVoice);
song.effects.forEach((_, e) => { inputs[ticks - 50 * (song.effects.length - e) - 40] = e + 1; });
if (quietFrom >= 0 && sids === 1) for (let t = ticks - 50 * (song.effects.length - quietFrom) - 40; t < ticks; t++) inputs[t] |= 128;
build(dir, { song: name, sids, script: runs(inputs) });
const out = path.join(__dirname, 'out', `${name}-music${sids === 2 ? '-2sid' : ''}.wav`);
fs.mkdirSync(path.dirname(out), { recursive: true });
try { fs.unlinkSync(out); } catch (e) { /* not there yet */ }
spawnSync(exe, ['-default', '-sound', '-sounddev', 'dump', '-soundarg', path.join(dir, 'sid.dump'), '-soundrecdev', 'wav', '-soundrecarg', out, '+confirmonexit',
  ...(sids === 2 ? ['-sidextra', '1', '-sid2address', '0xd420'] : []), '-autostartprgmode', '1', '-limitcycles', String(Math.round((seconds + 3) * 985248)), '-autostart', path.join(dir, 'sound.prg')], { timeout: (seconds + 60) * 1000 });
fs.rmSync(dir, { recursive: true, force: true });
if (!fs.existsSync(out)) throw new Error('VICE wrote no WAV');
const mp3 = out.replace(/\.wav$/, '.mp3');
const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', out, '-af', 'silenceremove=start_periods=1:start_threshold=-60dB', '-c:a', 'libmp3lame', '-b:a', '192k', mp3]);
if (ff.status) throw new Error('ffmpeg failed: ' + ff.stderr);
console.log(`${path.relative(process.cwd(), out)}: ${(fs.statSync(out).size / 1024).toFixed(0)} KB; ${path.basename(mp3)}: ${(fs.statSync(mp3).size / 1024).toFixed(0)} KB`);
