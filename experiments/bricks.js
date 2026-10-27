// Experiment: brick texture on the C64 view's walls, within the character set's free codes.
//
// Full wall cells (both rays solid wall of the same shade in that cell) get brick glyphs: each ray's
// 4-pixel strip is plain, has a mortar line at line 0/2/4/6, or is a vertical joint. The wall has
// 4 courses of bricks; joints sit at u = 0 and 128 on even courses and 64 and 192 on odd ones.
// Edge cells (wall tops and bottoms) keep the raycast set's glyphs.
//
//   node experiments/bricks.js <out.png> [--rom chargen]
//
// Writes a sheet: rows are poses from the walk; columns are the current look and each mortar scheme:
//   other  mortar in the other wall shade (one glyph set for both halves)
//   dark   mortar in the ceiling/floor colour (darkness behind the bricks; top and bottom sets)
const fs = require('fs'), { spawnSync } = require('child_process');
const APEXSCII = require('../apexscii/apexscii.js');
const VIEW = require('../c64/view.js');
const SPRITES = require('../c64/sprites.js');
const walk = require('../showcase/walk.js');
const { RAY } = APEXSCII;

const FREE = [...Array.from({ length: 0x40 }, (_, i) => i), ...Array.from({ length: 0x100 - 0xe2 }, (_, i) => 0xe2 + i)];
const PLAIN = 0, JOINT = 5; // strip types; 1-4 are a mortar line at line 0, 2, 4, 6

// The strip type of a ray in the cell whose top line is y (view lines, 0 = top, 80 = horizon).
function strip(rays, c, y) {
  const r = rays[c], h = r.halfH, top = 80 - h, course = h / 2;
  if (course < 4) return PLAIN; // too far for bricks to show
  // a mortar line between courses inside this cell, rounded down to an even line
  for (let n = 1; n < 4; n++) {
    const ym = Math.round(top + n * course);
    if (ym >= y && ym < y + 8) return 1 + ((ym - y) >> 1);
  }
  // a vertical joint: this ray's course, and whether a joint lies between it and the next ray
  const n = Math.floor((y + 4 - top) / course), off = n & 1 ? 64 : 0, nx = rays[c + 1] || rays[c - 1];
  if (!nx || nx.mapX !== r.mapX || nx.mapY !== r.mapY || nx.side !== r.side) return PLAIN;
  let a = r.u, b = c + 1 < rays.length && rays[c + 1] === nx ? nx.u : r.u + (r.u - nx.u);
  if (b < a) [a, b] = [b, a];
  for (const j of [off, off + 128, off + 256]) if (j >= a && j < b) return JOINT;
  return PLAIN;
}

function render(map, pose, scheme, rom) {
  const f = VIEW.frame(map, pose, 'mc', VIEW.statusLines(map, pose));
  const chars = f.chars.map(g => Uint8Array.from(g)), screen = Uint8Array.from(f.screen);
  if (scheme !== 'none') {
    const rays = VIEW.caster.cast(map, pose.x, pose.y, pose.a), made = new Map();
    let free = 0, overflow = 0;
    const glyph = (sl, sr, shade, half) => {
      const key = `${sl},${sr},${shade},${scheme === 'dark' ? half : ''}`;
      if (made.has(key)) return made.get(key);
      if (free >= FREE.length) { overflow++; return null; }
      const wall = shade ? 3 : 2, mortar = scheme === 'other' ? 5 - wall : half === 'top' ? 0 : 1;
      const rowOf = (s, line) => (s === JOINT || (s >= 1 && s <= 4 && line === 2 * (s - 1)) ? mortar : wall);
      const g = Uint8Array.from({ length: 8 }, (_, line) => {
        const L = rowOf(sl, line), R = rowOf(sr, line);
        return (L << 6) | (L << 4) | (R << 2) | R;
      });
      const code = FREE[free++];
      chars[code] = g;
      made.set(key, code);
      return code;
    };
    for (let cx = 0; cx < 40; cx++) {
      const L = rays[2 * cx], R = rays[2 * cx + 1];
      for (let cy = 0; cy < VIEW.VIEW_ROWS; cy++) {
        const y = cy * 8, below = cy < 10 ? 9 - cy : cy - 10, half = cy < 10 ? 'top' : 'bottom';
        const full = r => r.halfH - 8 * below >= 8;
        if (!full(L) || !full(R) || L.side !== R.side) continue;
        const sl = strip(rays, 2 * cx, y), sr = strip(rays, 2 * cx + 1, y);
        if (sl === PLAIN && sr === PLAIN) continue;
        const code = glyph(sl, sr, L.side === 0 ? 1 : 0, half);
        if (code !== null) screen[cy * 40 + cx] = code;
      }
    }
    render.stats = { glyphs: made.size, overflow };
  }
  const opts = f.opts;
  const px = APEXSCII.screenRGB(chars, screen, f.color, opts, rom);
  // the engine's gradient and 38 columns, as view.js draws them
  const PAL = APEXSCII.PALETTE.map(h => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16)));
  for (let cy = 0; cy < VIEW.VIEW_ROWS; cy++) for (let cx = 0; cx < 40; cx++) {
    const g = chars[screen[cy * 40 + cx]];
    for (let yy = 0; yy < 8; yy++) for (let x = 0; x < 8; x++) {
      const v = (g[yy] >> (6 - 2 * (x >> 1))) & 3, line = cy * 8 + yy;
      if (v > 1) continue;
      const c = PAL[v ? VIEW.GRADIENT.floor[Math.max(0, line - 80)] : VIEW.GRADIENT.ceiling[Math.min(79, line)]];
      const p = (line * 320 + cx * 8 + x) * 4;
      px[p] = c[0]; px[p + 1] = c[1]; px[p + 2] = c[2];
    }
  }
  const out = SPRITES.overlay(px, f.sprites);
  for (let y = 0; y < 200; y++) for (const x of [0, 1, 2, 3, 4, 5, 6, 311, 312, 313, 314, 315, 316, 317, 318, 319]) {
    const p = (y * 320 + x) * 4; out[p] = out[p + 1] = out[p + 2] = 0;
  }
  return out;
}

if (require.main === module) {
  const args = process.argv.slice(2), romArg = args.indexOf('--rom');
  const rom = romArg >= 0 ? fs.readFileSync(args[romArg + 1]).subarray(0, 2048) : null;
  const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--rom');
  const route = walk.path(), poses = [150, 290, 570, 700].map(k => route[k]), schemes = ['none', 'other', 'dark'];
  const W = 320, H = 200, sheet = Buffer.alloc(W * schemes.length * H * poses.length * 3);
  let most = { other: 0, dark: 0 };
  poses.forEach((p, r) => schemes.forEach((s, c) => {
    const px = render(walk.map, p, s, rom);
    if (s !== 'none') most[s] = Math.max(most[s], render.stats.glyphs + render.stats.overflow);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, o = ((r * H + y) * W * schemes.length + c * W + x) * 3;
      sheet[o] = px[i]; sheet[o + 1] = px[i + 1]; sheet[o + 2] = px[i + 2];
    }
  }));
  // glyphs needed over the whole walk
  for (const s of ['other', 'dark']) for (const p of route.filter((_, k) => k % 10 === 0)) { render(walk.map, p, s, rom); most[s] = Math.max(most[s], render.stats.glyphs + render.stats.overflow); }
  const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W * schemes.length}x${H * poses.length}`,
    '-i', '-', '-vf', 'scale=iw*2:ih*2:flags=neighbor', '-frames:v', '1', file], { input: sheet });
  if (ff.status) throw new Error(String(ff.stderr));
  console.log(`${file}: most glyphs one frame needs: other ${most.other}, dark ${most.dark} (${FREE.length} free)`);
}

module.exports = { render, strip };
