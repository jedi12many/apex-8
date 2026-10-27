// Records the real C64 engine in VICE: a scripted walk through E1M1 (the same controls a joystick
// gives), with a screenshot of every second 50 Hz frame through VICE's remote monitor, joined into a
// video. What you see is exactly what a C64 shows, at its real speed.
//
//   node showcase/c64-video.js <path to VICE folder> [--seconds 27]
//
// Writes showcase/out/c64-e1m1.mp4. Needs cc65, VICE and ffmpeg.
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net');
const { spawn, spawnSync } = require('child_process');
const { findVice, labels } = require('../test/vice-lib.js');
const { build } = require('../c64/build.js');

const args = process.argv.slice(2);
const viceDir = args.find(a => !a.startsWith('--') && !/^\d/.test(a));
const secArg = args.indexOf('--seconds');
const seconds = secArg >= 0 ? +args[secArg + 1] : 27;
if (!viceDir) { console.error('usage: node showcase/c64-video.js <VICE folder> [--seconds 27]'); process.exit(2); }

// Ticks (50 Hz) per input: 1 forward, 2 back, 4 turn left, 8 turn right. A quarter turn is 64 ticks,
// one tile 43. Look around, then down the corridor towards the guards, north past the barrels and
// treasure, and east into the room at the top.
const SCRIPT = [
  [0, 25], [8, 40], [4, 80], [8, 40], [0, 10],
  [8, 64], [1, 43], [4, 64], [1, 200], [1, 144], [0, 15],
  [4, 64], [1, 200], [1, 13], [0, 15], [8, 64], [0, 30], [1, 60], [0, 60],
];

(async () => {
  const { exe } = findVice(viceDir);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-video-'));
  build(null, dir, { script: SCRIPT });
  const top = labels(path.join(dir, 'apex.lbl')).irq_top.toString(16);
  const frames = path.join(dir, 'frames');
  fs.mkdirSync(frames);
  const want = seconds * 25;
  const vice = spawn(exe, ['-default', '-sounddev', 'dummy', '+confirmonexit', '-autostartprgmode', '1', '-initbreak', '0x' + top,
    '-remotemonitor', '-remotemonitoraddress', 'ip4://127.0.0.1:6510', '-autostart', path.join(dir, 'apex.prg')], { stdio: 'ignore' });
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
  const out = path.join(__dirname, 'out', 'c64-e1m1.mp4');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '25', '-i', path.join(frames, 'f%05d.png'),
    '-vf', 'scale=iw*2:ih*2:flags=neighbor', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', out]);
  if (ff.status) throw new Error('ffmpeg failed: ' + ff.stderr);
  console.log(`${path.relative(process.cwd(), out)}: ${fs.readdirSync(frames).length} frames from VICE`);
  fs.rmSync(dir, { recursive: true, force: true });
})().catch(e => { console.error(e.message); process.exit(1); });
