// Converts a picture into a C64 multicolor bitmap: 160 x 200 fat pixels, each 4 x 8 cell black ($D021)
// and up to 3 colours of its own from the 16, the shading between them ordered-dithered. For each cell
// it tries every 3 of the colours its pixels come nearest to and keeps the 3 that match it best.
//
//   node art/picture.js <image> <out.kla> [--crop x,y,w,h] [--bright 0] [--saturation 1] [--gamma 1]
//                       [--dither 30]
//
// --crop takes that part of the image (default all of it), which is scaled to fill the screen;
// --bright, --saturation and --gamma adjust it first (ffmpeg's eq filter); --dither is the ordered
// dither's strength. Writes <out.kla> (Koala Painter: load address $6000, the 8000-byte bitmap, 1000
// screen bytes (colours for 01 and 10), 1000 colour RAM bytes (11), the background) and <out>.png (how
// a C64 shows it, with its border). Needs ffmpeg.
const fs = require('fs'), path = require('path'), zlib = require('zlib'), { spawnSync } = require('child_process');
const APEXSCII = require('../apexscii/apexscii.js');

const W = 160, H = 200, BG = 0;
const PAL = APEXSCII.PALETTE.map(h => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16)));
// Colour distance ("redmean": weighted by how red the pair is, close to how the eye sees it).
const dist = (a, b) => {
  const r = (a[0] + b[0]) / 2, dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return (2 + r / 256) * dr * dr + 4 * dg * dg + (2 + (255 - r) / 256) * db * db;
};
const nearest = (c, set) => set.reduce((best, k) => (dist(c, PAL[k]) < dist(c, PAL[best]) ? k : best), set[0]);
const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
const ALL = Array.from({ length: 16 }, (_, k) => k);

// rgb: W x H x 3 bytes. Returns { px (a C64 colour per fat pixel), kla (the Koala file's bytes) }.
function convert(rgb, spread = 30) {
  const c = cells(rgb, 40, 25, spread);
  return { px: c.px, kla: Buffer.concat([Buffer.from([0x00, 0x60]), c.bitmap, c.screen, c.colram, Buffer.from([BG])]) };
}

// The same for a picture of any size: rgb is (4 * cw) x (8 * ch) fat pixels x 3 bytes. Returns
// { cw, ch, bg, px (a colour per fat pixel, 4 * cw a row), bitmap (8 bytes a cell, cells row by row),
// screen and colram (a byte a cell) }.
function cells(rgb, cw, ch, spread = 30) {
  const W = 4 * cw;
  const dithered = (x, y, set) => {
    const i = (y * W + x) * 3, d = (BAYER[y & 3][x & 3] / 16 - 0.47) * spread;
    return nearest([rgb[i] + d, rgb[i + 1] + d, rgb[i + 2] + d], set);
  };
  const px = new Uint8Array(W * 8 * ch), bitmap = new Uint8Array(8 * cw * ch), screen = new Uint8Array(cw * ch), colram = new Uint8Array(cw * ch);
  for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) {
    const counts = new Map();
    for (let y = 8 * cy; y < 8 * cy + 8; y++) for (let x = 4 * cx; x < 4 * cx + 4; x++) {
      const k = dithered(x, y, ALL);
      if (k !== BG) counts.set(k, (counts.get(k) || 0) + 1);
    }
    const cand = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a)).slice(0, 7);
    while (cand.length < 3) cand.push(cand.length ? cand[0] : 11);
    let best = null, bestErr = Infinity;
    for (let a = 0; a < cand.length; a++) for (let b = a; b < cand.length; b++) for (let c = b; c < cand.length; c++) {
      const set = [BG, cand[a], cand[b], cand[c]];
      let err = 0;
      for (let y = 8 * cy; y < 8 * cy + 8; y++) for (let x = 4 * cx; x < 4 * cx + 4; x++) {
        const i = (y * W + x) * 3;
        err += dist([rgb[i], rgb[i + 1], rgb[i + 2]], PAL[dithered(x, y, set)]);
      }
      if (err < bestErr) { bestErr = err; best = set; }
    }
    const set = [best[1], best[2], best[3]];
    screen[cy * cw + cx] = (set[0] << 4) | set[1];
    colram[cy * cw + cx] = set[2];
    for (let y = 0; y < 8; y++) {
      let byte = 0;
      for (let f = 0; f < 4; f++) {
        const k = dithered(4 * cx + f, 8 * cy + y, best);
        px[(8 * cy + y) * W + 4 * cx + f] = k;
        byte |= (k === BG ? 0 : set.indexOf(k) + 1) << (6 - 2 * f);
      }
      bitmap[(cy * cw + cx) * 8 + y] = byte;
    }
  }
  return { cw, ch, bg: BG, px, bitmap, screen, colram };
}

// A picture file as RGB, scaled (after any ffmpeg filters) to w x h. Needs ffmpeg.
function load(file, w, h, filters = []) {
  const ff = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', [...filters, `scale=${w}:${h}:flags=lanczos`].join(','), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 26 });
  if (ff.status) throw new Error('ffmpeg failed: ' + ff.stderr);
  return ff.stdout;
}

// A picture as a C64 shows it (320 x 200, each fat pixel 2 wide), with a black border, as a PNG.
function png(px) {
  const PW = 384, PH = 272, img = Buffer.alloc((PW * 3 + 1) * PH);
  for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) {
    const inside = x >= 32 && x < 352 && y >= 36 && y < 236;
    img.set(inside ? PAL[px[(y - 36) * W + ((x - 32) >> 1)]] : PAL[0], y * (PW * 3 + 1) + 1 + x * 3);
  }
  const crc = b => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } let x = 0xffffffff; for (const v of b) x = t[(x ^ v) & 255] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; };
  const chunk = (ty, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(ty), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(PW); ih.writeUInt32BE(PH, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(img)), chunk('IEND', Buffer.alloc(0))]);
}

module.exports = { W, H, PAL, convert, cells, load, png };

if (require.main === module) {
  const args = process.argv.slice(2), opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
  const [src, out] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
  if (!src || !out) { console.error('usage: node art/picture.js <image> <out.kla> [--crop x,y,w,h] [--bright 0] [--saturation 1] [--gamma 1] [--dither 30]'); process.exit(2); }
  const crop = opt('--crop'), filters = [];
  if (crop) { const [x, y, w, h] = crop.split(',').map(Number); filters.push(`crop=${w}:${h}:${x}:${y}`); }
  filters.push(`scale=${W}:${H}:flags=lanczos`, `eq=brightness=${opt('--bright', 0)}:saturation=${opt('--saturation', 1)}:gamma=${opt('--gamma', 1)}`);
  const ff = spawnSync('ffmpeg', ['-v', 'error', '-i', src, '-vf', filters.join(','), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 26 });
  if (ff.status) throw new Error('ffmpeg failed: ' + ff.stderr);
  const { px, kla } = convert(ff.stdout, +opt('--dither', 30));
  fs.writeFileSync(out, kla);
  fs.writeFileSync(out.replace(/\.kla$/, '') + '.png', png(px));
  console.log(`${out}: ${kla.length} bytes, and ${path.basename(out.replace(/\.kla$/, ''))}.png`);
}
