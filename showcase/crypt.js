// An autopilot run through the Drowned Crypt (showcase/crypt-pilot.js), rendered by the reference at
// 50 fps, as a video at 25 fps (every second frame) with the C64 border: the title, the crypt cleared
// room by room, the boss, and the win.
//
//   node showcase/crypt.js
//
// Writes showcase/out/crypt-run.mp4. Needs ffmpeg.
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const APEXSCII = require('../apexscii/apexscii.js');
const G = require('../core/crypt.js');
const VIEW = require('../c64/crypt/view.js');
const IV = require('../c64/iso/view.js');
const pilot = require('./crypt-pilot.js');

const M = G.parse(fs.readFileSync(path.join(__dirname, '..', 'levels', 'iso', 'c1.txt'), 'utf8'));
const TITLE = 150, AFTER = 200;
// play until the win (or the loss) and its message has shown for AFTER ticks
const { inputs } = pilot.inputs(M, 9000, TITLE);
const game = G.game(M), ticks = [];
let end = inputs.length;
inputs.forEach((b, n) => {
  if (n >= end) return;
  G.tick(M, game, b);
  if ((game.mode === G.WIN || game.mode === G.OVER) && end === inputs.length) end = n + AFTER;
  ticks.push(n);
});
const PAL = APEXSCII.PALETTE.map(h => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16)));
const FW = 384, FH = 272, frames = [];
const replay = G.game(M);
for (const n of ticks) {
  G.tick(M, replay, inputs[n]);
  if (n & 1) continue;
  const px = VIEW.frame(M, replay).pixels, buf = Buffer.alloc(FW * FH * 3);
  for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
    const inside = x >= 32 && x < 352 && y >= 36 && y < 236, i = ((y - 36) * 320 + (x - 32)) * 4;
    buf.set(inside ? [px[i], px[i + 1], px[i + 2]] : PAL[IV.COLORS.border], (y * FW + x) * 3);
  }
  frames.push(buf);
}
const out = path.join(__dirname, 'out', 'crypt-run.mp4');
fs.mkdirSync(path.dirname(out), { recursive: true });
const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${FW}x${FH}`, '-r', '25', '-i', '-',
  '-vf', 'scale=iw*2:ih*2:flags=neighbor', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', out], { input: Buffer.concat(frames), maxBuffer: 2 ** 31 });
if (ff.status) throw new Error('ffmpeg failed: ' + ff.stderr);
console.log(`${path.relative(process.cwd(), out)}: ${frames.length} frames, ${(frames.length / 25).toFixed(1)} s; ` +
  `${replay.mode === G.WIN ? 'won' : replay.mode === G.OVER ? 'lost' : 'unfinished'}, score ${replay.score}, hearts ${replay.hero.hearts} (no sound yet)`);
