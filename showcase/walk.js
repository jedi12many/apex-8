// A walk through E1M1 in the C64 raycast view: the player looks around, then follows a loop of
// corridors and rooms, turning smoothly at each corner.
//
//   node showcase/walk.js [--rom <chargen file>]
//
// Writes showcase/out/walk-mc.mp4 and walk-hires.mp4 (25 fps, 768x544, needs ffmpeg), plus stills as
// runnable .prg files and a contact sheet, walk.png. test/vice-check.js loads stills() and checks them in VICE.
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const APEXSCII = require('../apexscii/apexscii.js');
const APEXRAY = require('../core/raycast.js');
const LEVEL = require('../core/level.js');
const VIEW = require('../c64/view.js');

const map = LEVEL.parse(fs.readFileSync(path.join(__dirname, '..', 'levels', 'e1m1.txt'), 'utf8'));
const centre = t => t * 256 + 128;
// Tile centres to walk through, in order; every leg is straight along a row or column.
const ROUTE = [[3, 11], [11, 11], [11, 6], [13, 6], [13, 2], [9, 2], [9, 4], [5, 4], [5, 6], [3, 6], [3, 10]];
const SPEED = 24, TURN = 8; // per frame: 24/256 tile, 8/1024 of a turn (2.8°)

// Every player position along the route: a half-turn look-around first, then the legs.
function path_() {
  const p = { ...map.start }, out = [];
  const push = () => out.push({ ...p });
  const turnTo = a => {
    for (;;) {
      const d = ((a - p.a + 512) & 1023) - 512;
      if (!d) return;
      p.a = (p.a + Math.sign(d) * Math.min(TURN, Math.abs(d))) & 1023;
      push();
    }
  };
  push();
  turnTo(768); turnTo(256); turnTo(0);
  for (const [tx, ty] of ROUTE) {
    const x = centre(tx), y = centre(ty);
    turnTo(x > p.x ? 0 : x < p.x ? 512 : y > p.y ? 256 : 768);
    while (p.x !== x || p.y !== y) {
      p.x += Math.sign(x - p.x) * Math.min(SPEED, Math.abs(x - p.x));
      p.y += Math.sign(y - p.y) * Math.min(SPEED, Math.abs(y - p.y));
      push();
    }
  }
  turnTo(0);
  for (let k = 0; k < 25; k++) push();
  return out;
}

const frameAt = (p, mode) => VIEW.frame(map, p, mode, VIEW.statusLines(map, p));

// Stills for the VICE test: a few points on the route, in both modes.
function stills() {
  const route = path_(), picks = [0, 240, 300, 540, 660];
  return picks.flatMap(k => ['mc', 'hires'].map(mode => ({ name: `walk-${mode}-${String(k).padStart(4, '0')}`, frame: frameAt(route[k], mode) })));
}

module.exports = { map, path: path_, stills };

if (require.main === module) {
  const args = process.argv.slice(2), romArg = args.indexOf('--rom');
  const rom = romArg >= 0 ? fs.readFileSync(args[romArg + 1]).subarray(0, 2048) : null;
  const out = path.join(__dirname, 'out');
  fs.mkdirSync(out, { recursive: true });
  const PAL = APEXSCII.PALETTE.map(h => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16)));
  const FW = 384, FH = 272;
  // One frame with the C64 border around it.
  const bordered = (rgba, border, into, stride, ox, oy) => {
    for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
      const inside = x >= 32 && x < 352 && y >= 35 && y < 235, p = ((y - 35) * 320 + (x - 32)) * 4;
      into.set(inside ? rgba.subarray(p, p + 3) : PAL[border], ((oy + y) * stride + ox + x) * 3);
    }
  };
  const route = path_();
  for (const mode of ['mc', 'hires']) {
    const file = path.join(out, `walk-${mode}.mp4`);
    const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${FW}x${FH}`, '-r', '25',
      '-i', '-', '-vf', 'scale=iw*2:ih*2:flags=neighbor', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', file],
    { input: Buffer.concat(route.map(p => {
      const f = frameAt(p, mode), buf = Buffer.alloc(FW * FH * 3);
      bordered(f.rgba(rom), f.opts.border, buf, FW, 0, 0);
      return buf;
    })), maxBuffer: 1 << 30 });
    if (ff.status) throw new Error('ffmpeg failed: ' + ff.stderr);
    console.log(`${path.basename(file)}: ${route.length} frames, ${(route.length / 25).toFixed(1)} s`);
  }
  const all = stills(), COLS = 2, ROWS = Math.ceil(all.length / COLS), sheet = Buffer.alloc(COLS * FW * ROWS * FH * 3);
  all.forEach((s, k) => {
    fs.writeFileSync(path.join(out, `${s.name}.prg`), s.frame.prg());
    bordered(s.frame.rgba(rom), s.frame.opts.border, sheet, COLS * FW, (k % COLS) * FW, ((k / COLS) | 0) * FH);
  });
  const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${COLS * FW}x${ROWS * FH}`,
    '-i', '-', '-frames:v', '1', path.join(out, 'walk.png')], { input: sheet });
  if (ff.status) throw new Error('ffmpeg failed: ' + ff.stderr);
  console.log(`walk.png and ${all.length} .prg stills`);
}
