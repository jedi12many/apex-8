// An autopilot run through the platformer's first level, rendered by the reference at 50 fps, as a video
// at 25 fps (every second frame) with the C64 border.
//
//   node showcase/side.js
//
// Writes showcase/out/side-run.mp4. Needs ffmpeg.
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const APEXSCII = require('../apexscii/apexscii.js');
const PLAT = require('../core/platform.js');
const VIEW = require('../c64/side/view.js');

const level = PLAT.parse(fs.readFileSync(path.join(__dirname, '..', 'levels', 'side', 'w1.txt'), 'utf8'));
const map = VIEW.compose(level);
// An autopilot: run right, jumping at a wall or a pit ahead and holding jump while rising; at the end
// of the level, stop.
function autopilot(p) {
  const B = PLAT.BLOCK, front = p.x + PLAT.PHYS.width, feet = p.y + PLAT.PHYS.height;
  if (Math.floor(p.x / B) >= level.w - 3) return 0;
  const solid = (x, y) => PLAT.solidAt(level, Math.floor(x / B), Math.floor(y / B));
  // a pit: nothing under the next step for 3 blocks down (a ledge with ground below is walked off)
  const pit = [0, 1, 2].every(d => !solid(front + 2 * 16, feet + 16 + d * B)), wall = solid(front + 10 * 16, feet - 16) || solid(front + 10 * 16, p.y + 16);
  if (p.ground) return pit || wall ? 6 : 2;
  return p.vy < 0 ? 6 : 2;
}
const SECONDS = 26;

const PAL = APEXSCII.PALETTE.map(h => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16)));
const FW = 384, FH = 272, frames = [];
const p = PLAT.player(level);
let cam = PLAT.follow(level, p, 0), n = 0;
for (; n < SECONDS * 50; n++) {
  PLAT.tick(level, p, autopilot(p));
  cam = PLAT.follow(level, p, cam);
  if (n & 1) continue;
  const px = VIEW.frame(level, map, p, cam).pixels, buf = Buffer.alloc(FW * FH * 3);
  for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
    const inside = x >= 32 && x < 352 && y >= 36 && y < 236, i = ((y - 36) * 320 + (x - 32)) * 4;
    buf.set(inside ? [px[i], px[i + 1], px[i + 2]] : PAL[VIEW.BORDER], (y * FW + x) * 3);
  }
  frames.push(buf);
}
const out = path.join(__dirname, 'out', 'side-run.mp4');
fs.mkdirSync(path.dirname(out), { recursive: true });
const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${FW}x${FH}`, '-r', '25', '-i', '-',
  '-vf', 'scale=iw*2:ih*2:flags=neighbor', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', out], { input: Buffer.concat(frames), maxBuffer: 1 << 30 });
if (ff.status) throw new Error('ffmpeg failed: ' + ff.stderr);
console.log(`${path.relative(process.cwd(), out)}: ${frames.length} frames, ${(frames.length / 25).toFixed(1)} s; ended at x ${(p.x / 256).toFixed(1)} blocks`);
