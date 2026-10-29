// Records the C64 shoot-'em-up in VICE: the title for 3 seconds, then the autopilot
// (showcase/shmup-pilot.js) flies the Dreadnought through the engine's script input, with a screenshot
// of every second 50 Hz frame through VICE's remote monitor, joined into a video. A second run of the
// same script records the SID, from the music's first sound, as the video's soundtrack. What you see
// and hear is exactly what a C64 does, at its real speed.
//
//   node showcase/shmup-c64-video.js <path to VICE folder> [--seconds 40]
//
// Writes showcase/out/shmup-c64.mp4. Needs cc65, VICE and ffmpeg.
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net');
const { spawn, spawnSync } = require('child_process');
const { findVice, labels } = require('../test/vice-lib.js');
const { level, build, runs } = require('../c64/shmup/build.js');
const pilot = require('./shmup-pilot.js');

const args = process.argv.slice(2);
const viceDir = args.find(a => !a.startsWith('--') && !/^\d/.test(a));
const secArg = args.indexOf('--seconds');
const seconds = secArg >= 0 ? +args[secArg + 1] : 40;
if (!viceDir) { console.error('usage: node showcase/shmup-c64-video.js <VICE folder> [--seconds 40]'); process.exit(2); }

(async () => {
  const { exe } = findVice(viceDir);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-video-'));
  build(dir, { script: runs(pilot.inputs(level, seconds * 50, 150).inputs) });
  const top = labels(path.join(dir, 'shmup.lbl')).irq_bottom.toString(16);
  const frames = path.join(dir, 'frames');
  fs.mkdirSync(frames);
  const want = seconds * 25;
  const vice = spawn(exe, ['-default', '-sounddev', 'dummy', '+confirmonexit', '-autostartprgmode', '1', '-initbreak', '0x' + top,
    '-remotemonitor', '-remotemonitoraddress', 'ip4://127.0.0.1:6510', '-autostart', path.join(dir, 'shmup.prg')], { stdio: 'ignore' });
  await new Promise((resolve, reject) => {
    let out = '', stops = 0, shots = 0, queue = [];
    const timer = setTimeout(() => reject(new Error('VICE stopped answering')), 600000);
    const connect = () => {
      const s = net.connect(6510, '127.0.0.1');
      s.on('error', () => setTimeout(connect, 300));
      const send = () => { const c = queue.shift(); if (c) s.write(c + '\n'); };
      s.on('data', d => {
        out += d;
        if (!/\(C:\$[0-9a-f]{4}\) $/i.test(out)) return;
        const stopped = /Stop on|\(C:\$/i.test(out);
        out = '';
        if (queue.length) return send();
        if (!stopped) return;
        stops++;
        if (shots >= want) { clearTimeout(timer); s.write('quit\n'); return setTimeout(resolve, 500); }
        if (stops === 1) queue.push(`break ${top}`);
        else if (stops % 2 === 0) queue.push(`screenshot "${path.join(frames, `f${String(shots++).padStart(5, '0')}.png`).replace(/\\/g, '/')}" 2`);
        queue.push('x');
        send();
      });
    };
    setTimeout(connect, 500);
  });
  vice.kill();
  // the sound: the same program at its real speed, recorded, from its first sound (the music starts on
  // the first frame)
  const wav = path.join(dir, 'sound.wav');
  spawnSync(exe, ['-default', '-sound', '-sounddev', 'dump', '-soundarg', path.join(dir, 'sid.dump'), '-soundrecdev', 'wav', '-soundrecarg', wav, '+confirmonexit',
    '-autostartprgmode', '1', '-limitcycles', String(Math.round((seconds + 4) * 985248)), '-autostart', path.join(dir, 'shmup.prg')], { timeout: (seconds + 60) * 1000 });
  const out = path.join(__dirname, 'out', 'shmup-c64.mp4');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  // (VICE's silent 'dump' sound device: the recorder needs a device running, and this one plays nothing)
  const audio = fs.existsSync(wav) && fs.statSync(wav).size > 1000 ? ['-i', wav, '-af', 'silenceremove=start_periods=1:start_threshold=-60dB', '-c:a', 'aac', '-b:a', '160k', '-shortest'] : [];
  const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '25', '-i', path.join(frames, 'f%05d.png'), ...audio,
    '-vf', 'scale=iw*2:ih*2:flags=neighbor', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', out]);
  if (ff.status) throw new Error('ffmpeg failed: ' + ff.stderr);
  console.log(`${path.relative(process.cwd(), out)}: ${fs.readdirSync(frames).length} frames from VICE${audio.length ? ', with its sound' : ' (no sound: VICE wrote no WAV)'}`);
  fs.rmSync(dir, { recursive: true, force: true });
})().catch(e => { console.error(e.message); process.exit(1); });
