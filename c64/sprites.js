/*
 * Objects in the C64 raycast view as hardware sprites.
 *
 * Each frame, every visible object goes through these steps:
 *   1. projected with the reference raycaster
 *   2. scaled to its depth from multicolor source art
 *   3. masked column by column against the rays, so it disappears behind nearer walls
 *   4. cut into 24x21 sprites; an object uses X/Y expansion when that takes fewer sprites
 * The nearest objects claim the VIC's 8 sprites first, and an object that doesn't fit whole is skipped.
 * A C64 engine does the same work each frame: the masked copy is a few hundred bytes.
 *
 * Source art: '.' transparent, 'a' $D025 (black outline), 'b' the object's own colour,
 * 'c' $D026 (light red: skin, highlights). One fat pixel is two screen pixels wide.
 */
const APEXSCII = require('../apexscii/apexscii.js');

const SHARED = { mc1: 0, mc2: 10 };

const GUARD = [
  '......aaaa......', '....aabbbbaa....', '...abbbbbbbba...', '...abbbbbbbba...', '..aaaaaaaaaaaa..',
  '...acccccccca...', '...acaaccaaca...', '...acccccccca...', '...accccaccca...', '...acccccccca...',
  '....accaacca....', '.....acccca.....', '......acca......', '...aaabbbbaaa...', '..abbbbbbbbbba..',
  '.abbbbbabbabbbba', '.abbbbbabbabbbba', 'abbbbbbbaabbbbba', 'abbabbbbbbbbabba', 'abbabbbbbbbbabba',
  'abbabbbbbbbbabba', 'abbabbbbbbbbabba', 'abbabbbbbbbbabba', 'abbaaaaaaaaaabba', 'abbabbbccbbbabba',
  'abbabbbbbbbbabba', 'acca.bbbbbb.acca', 'acca.bbbbbb.acca', '.aa..bbbbbb.aaaa', '.....bbbbbb.aaa.',
  '....abbbabbba...', '....abbbaabbba..', '....abbbaabbba..', '....abbbaabbba..', '....abbbaabbba..',
  '....abbbaabbba..', '....abbbaabbba..', '....abbbaabbba..', '....abbbaabbba..', '....abbbaabbba..',
  '....abbbaabbba..', '....abbbaabbba..', '....abbbaabbba..', '....abbbaabbba..', '....abbbaabbba..',
  '....abbbaabbba..', '....aaaaa.aaaaa.', '....aaaaa.aaaaa.', '...aaaaaa.aaaaaa', '...aaaaaa.aaaaaa',
];
const BARREL = [
  '...aaaa...', '.aabbbbaa.', 'abcbbbbbba', 'aaaaaaaaaa', 'abcbbbbbba', 'abcbbbbbba', 'abcbbbbbba',
  'abcbbbbbba', 'abcbbbbbba', 'aaaaaaaaaa', 'abcbbbbbba', 'abcbbbbbba', 'abcbbbbbba', 'abcbbbbbba',
  'abcbbbbbba', 'abcbbbbbba', 'aaaaaaaaaa', 'abcbbbbbba', 'abcbbbbbba', 'abcbbbbbba', 'abcbbbbbba',
  'abcbbbbbba', 'aaaaaaaaaa', '.aabbbbaa.', '...aaaa...',
];
const TREASURE = [
  'aaaaaaaaaa', 'abccbbbbba', 'abcbbbbbba', 'abcbbbbbba', '.abbbbbba.', '..abbbba..', '...abba...',
  '....aa....', '....ab....', '....ab....', '...abba...', '..abbbba..', '.abbbbbba.', 'aaaaaaaaaa',
];
// height: the object's height as a fraction of a wall, in 256ths.
const TYPES = {
  guard: { art: GUARD, color: 9, height: 218 },
  barrel: { art: BARREL, color: 5, height: 150 },
  treasure: { art: TREASURE, color: 7, height: 80 },
};
for (const [name, t] of Object.entries(TYPES)) {
  if (t.art.some(r => r.length !== t.art[0].length)) throw new Error(`sprite art for ${name} has ragged rows`);
}

// The sprite set for one frame. view: { horizon, rows (pixel rows of the view), pxPerRay }.
// Returns { mc1, mc2, frames, list } as overlaySprites and spritePrg take it.
function place(caster, rays, objects, player, view) {
  const seen = [];
  for (const o of objects) {
    const pr = caster.project(player, o.x, o.y);
    if (pr) seen.push({ o, pr });
  }
  seen.sort((p, q) => p.pr.depth - q.pr.depth);
  const frames = [], list = [];
  for (const { o, pr } of seen) {
    const tiles = cut(TYPES[o.type], pr, rays, view);
    if (!tiles.length || list.length + tiles.length > 8) continue;
    for (const t of tiles) { list.push({ ...t, frame: frames.length, color: TYPES[o.type].color }); frames.push(t.data); }
  }
  list.forEach(s => delete s.data);
  return { ...SHARED, frames, list };
}

// One object's masked sprites: [{ x, y, mc, xx, yy, data }].
function cut(type, pr, rays, view) {
  const art = type.art, artW = art[0].length, artH = art.length;
  const H = (2 * pr.halfH * type.height) >> 8;
  if (H < 4) return [];
  const W = Math.max(2, Math.round((H * artW * 2) / artH));
  // Fewer sprites wins; on a tie, unexpanded (finer pixels).
  const count = e => Math.ceil(W / (24 * (1 + e))) * Math.ceil(H / (21 * (1 + e)));
  const e = count(1) < count(0) ? 1 : 0, u = 2 * (1 + e), ey = 1 + e;
  const fatW = Math.max(1, Math.round(W / u)), rows = Math.max(1, Math.round(H / ey));
  const centre = Math.floor((pr.col * view.pxPerRay) / 256);
  const left = centre - ((fatW * u) >> 1), bottom = view.horizon + pr.halfH, top = bottom - rows * ey;
  // The scaled, masked image, in fat pixels.
  const img = [];
  let fx0 = Infinity, fx1 = -1, ry0 = Infinity, ry1 = -1;
  for (let ry = 0; ry < rows; ry++) {
    const line = new Uint8Array(fatW), Y = top + ry * ey;
    const src = art[Math.floor((ry * artH) / rows)];
    for (let fx = 0; fx < fatW; fx++) {
      const Xc = left + fx * u + (u >> 1), ray = Math.floor(Xc / view.pxPerRay);
      if (Y < 0 || Y + ey > view.rows || Xc < 0 || ray >= rays.length || pr.depth >= rays[ray].dist) continue;
      const v = '.abc'.indexOf(src[Math.floor((fx * artW) / fatW)]);
      if (!v) continue;
      line[fx] = v;
      fx0 = Math.min(fx0, fx); fx1 = Math.max(fx1, fx); ry0 = Math.min(ry0, ry); ry1 = Math.max(ry1, ry);
    }
    img.push(line);
  }
  const out = [];
  for (let ty = ry0; ty <= ry1; ty += 21) for (let tx = fx0; tx <= fx1; tx += 12) {
    const data = new Uint8Array(64);
    let any = false;
    for (let y = 0; y < 21 && ty + y < rows; y++) for (let x = 0; x < 12 && tx + x < fatW; x++) {
      const v = img[ty + y][tx + x];
      if (v) { data[y * 3 + (x >> 2)] |= v << (6 - 2 * (x & 3)); any = true; }
    }
    if (any) out.push({ x: left + tx * u, y: top + ty * ey, mc: true, xx: !!e, yy: !!e, data });
  }
  return out;
}

// Draw sprites over a 320x200 RGBA screen (from screenRGB) the way the VIC does; sprite 0 on top.
function overlay(rgba, sprites) {
  const pal = APEXSCII.PALETTE.map(h => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16)));
  for (let i = sprites.list.length - 1; i >= 0; i--) {
    const s = sprites.list[i], f = sprites.frames[s.frame], sx = s.xx ? 2 : 1, sy = s.yy ? 2 : 1;
    for (let y = 0; y < 21; y++) for (let x = 0; x < 24; x++) {
      const byte = f[y * 3 + (x >> 3)];
      const c = s.mc ? [-1, sprites.mc1, s.color, sprites.mc2][(byte >> (6 - 2 * ((x & 7) >> 1))) & 3]
                     : (byte >> (7 - (x & 7))) & 1 ? s.color : -1;
      if (c < 0) continue;
      for (let dy = 0; dy < sy; dy++) for (let dx = 0; dx < sx; dx++) {
        const X = s.x + x * sx + dx, Y = s.y + y * sy + dy;
        if (X >= 0 && Y >= 0 && X < 320 && Y < 200) rgba.set(pal[c], (Y * 320 + X) * 4);
      }
    }
  }
  return rgba;
}

// A runnable PRG with sprites: APEXSCII's screen program, plus the sprite frames at $2000 (pointers
// $80 up, stored at $07F8 with the screen) and a set-up routine after them that BASIC's SYS runs
// first; it programs the VIC's sprite registers and then jumps into the screen program at $0810.
function prg(chars, screen, color, opts, sprites) {
  const DATA = 0x2000, n = sprites.list.length;
  if (n > 8) throw new Error('the VIC has only 8 sprites');
  const scr = new Uint8Array(1024);
  scr.set(screen.subarray(0, 1000));
  sprites.list.forEach((s, i) => { scr[1016 + i] = (DATA >> 6) + s.frame; });
  const base = APEXSCII.screenPrg(chars, scr, color, opts);
  const init = DATA + Math.max(1, sprites.frames.length) * 64, code = [];
  const sta = (v, addr) => code.push(0xa9, v & 0xff, 0x8d, addr & 0xff, addr >> 8); // LDA #v : STA addr
  let msb = 0, mc = 0, xx = 0, yy = 0;
  sprites.list.forEach((s, i) => {
    const vx = s.x + 24, vy = s.y + 50; // VIC sprite coordinates of the screen's top-left corner
    sta(vx, 0xd000 + 2 * i); sta(vy, 0xd001 + 2 * i); sta(s.color, 0xd027 + i);
    if (vx > 255) msb |= 1 << i;
    if (s.mc) mc |= 1 << i;
    if (s.xx) xx |= 1 << i;
    if (s.yy) yy |= 1 << i;
  });
  sta(msb, 0xd010); sta(mc, 0xd01c); sta(xx, 0xd01d); sta(yy, 0xd017);
  sta(sprites.mc1, 0xd025); sta(sprites.mc2, 0xd026); sta((1 << n) - 1, 0xd015);
  code.push(0x4c, 0x10, 0x08); // JMP $0810
  const at = addr => 2 + addr - 0x0801, out = new Uint8Array(at(init + code.length));
  out.set(base);
  sprites.frames.forEach((f, k) => out.set(f, at(DATA + k * 64)));
  out.set(code, at(init));
  out.set(Array.from(String(init), ch => ch.charCodeAt(0)), at(0x0806)); // "10 SYS<init>" (4 digits)
  return out;
}

module.exports = { SHARED, TYPES, place, cut, overlay, prg };
