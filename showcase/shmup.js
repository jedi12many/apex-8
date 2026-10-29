// An autopilot run over the Dreadnought, rendered by the shoot-'em-up reference at 50 fps, as a video
// at 25 fps (every second frame) with the C64 border.
//
//   node showcase/shmup.js [--seconds 40]
//
// Writes showcase/out/shmup-run.mp4. Needs ffmpeg.
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const APEXSCII = require('../apexscii/apexscii.js');
const G = require('../core/shmup.js');
const VIEW = require('../c64/shmup/view.js');
const pilot = require('./shmup-pilot.js');

const args = process.argv.slice(2), secArg = args.indexOf('--seconds');
const SECONDS = secArg >= 0 ? +args[secArg + 1] : 40;
const level = G.parse(fs.readFileSync(path.join(__dirname, '..', 'levels', 'shmup', 's1.txt'), 'utf8'));
const { inputs } = pilot.inputs(level, SECONDS * 50, 150); // (3 seconds of the title first)

const PAL = APEXSCII.PALETTE.map(h => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16)));
const FW = 384, FH = 272, frames = [];
const game = G.game(level);
let most = 0;
inputs.forEach((b, n) => {
  G.tick(level, game, b);
  if (n & 1) return;
  const f = VIEW.frame(level, game), px = f.pixels, buf = Buffer.alloc(FW * FH * 3);
  most = Math.max(most, f.sprites.length);
  for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
    const inside = x >= 32 && x < 352 && y >= 36 && y < 236, i = ((y - 36) * 320 + (x - 32)) * 4;
    buf.set(inside ? [px[i], px[i + 1], px[i + 2]] : PAL[VIEW.COLORS.border], (y * FW + x) * 3);
  }
  frames.push(buf);
});
const out = path.join(__dirname, 'out', 'shmup-run.mp4');
fs.mkdirSync(path.dirname(out), { recursive: true });
const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${FW}x${FH}`, '-r', '25', '-i', '-',
  '-vf', 'scale=iw*2:ih*2:flags=neighbor', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', out], { input: Buffer.concat(frames), maxBuffer: 1 << 30 });
if (ff.status) throw new Error('ffmpeg failed: ' + ff.stderr);
console.log(`${path.relative(process.cwd(), out)}: ${frames.length} frames, ${(frames.length / 25).toFixed(1)} s; score ${game.score}, ships lost ${game.deaths}, at most ${most} sprites at once (no sound: showcase/shmup-c64-video.js records the C64's)`);
