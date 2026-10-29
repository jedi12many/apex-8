/*
 * The C64 raycast view: 80 rays drawn with APEXSCII's raycast character set.
 *
 * Screen rows 0-19 are the view (320x160, horizon between rows 9 and 10). Rows 20-24 are a status
 * panel in the C64's ROM font, shown through APEXSCII's raster split. Each screen column shows two
 * rays. Each half of the view is a mirror of the other, so one wall height gives both ends:
 *   top row r (0-9):     wall pixels in the cell = clamp(halfH - 8 * (9 - r), 0, 8), a "ray top" glyph
 *   bottom row 10 + r:   the same with 8 * r, a "ray bottom" glyph
 * Rays that hit an east/west face use wall shade B, north/south faces shade A, as Wolfenstein does.
 *
 * Multicolor colours: ceiling $D021, floor $D022, wall A $D023, wall B colour RAM (never changes).
 * Objects (guards, barrels, treasure) are hardware sprites; see sprites.js.
 *
 * The engine also shades the ceiling and floor towards the horizon by changing $D021 and $D022 on
 * the raster lines GRADIENT gives, with dithered stripes between shades. Top glyphs never use the
 * floor colour and bottom glyphs never the ceiling colour, so each register only has to change on
 * time in its own half of the view. It shows 38 columns: the border hides the leftmost 7 and rightmost
 * 9 pixels, where a colour change could land a cycle early or late. rgba(rom, true) draws all this.
 */
const APEXSCII = require('../apexscii/apexscii.js');
const APEXRAY = require('../core/raycast.js');
const SPRITES = require('./sprites.js');
const { RAY } = APEXSCII;

const VIEW_ROWS = 20, HALF_ROWS = VIEW_ROWS / 2, STATUS_ROWS = 25 - VIEW_ROWS;
const COLOURS = {
  mc: { bg: 11, mc1: 12, mc2: 14, wallB: 6, border: 0, text: 1, accent: 7 },
  hires: { bg: 0, ink: 14, border: 0, text: 1, accent: 7 },
};

// Ceiling and floor colour on each of the view's 160 pixel lines, from bands of [colour, lines]; a
// band [a, b, n] dithers a and b in stripes two lines high (a a b b a a b b). The ceiling runs from
// the top down to the horizon, the floor from the horizon down. The engine needs a line between colour
// changes, and can't change one on a bad line (every 8th line, starting with the first, where the VIC
// holds the CPU), so each dither band starts on a bad line.
function shades(list) {
  const out = [];
  for (const band of list) {
    if (band.length === 2) out.push(...Array(band[1]).fill(band[0]));
    else out.push(...Array.from({ length: band[2] }, (_, i) => (i & 2 ? band[1] : band[0])));
  }
  return out;
}
// DARK lines each side of the horizon are black, and a wall that would fit inside them is fog: the
// view leaves it out, and the engine stops each ray before it. 24 was tried too: about 3% faster, but
// walls and guards vanish under 5 tiles away.
const DARK = 16;
const GRADIENT = {
  ceiling: shades([[12, 24], [12, 11, 8], [11, 40 - DARK], [11, 0, 8], [0, DARK]]),
  floor: shades([[0, DARK], [0, 11, 8], [11, 48 - DARK], [11, 12, 8], [12, 16]]),
};
if (GRADIENT.ceiling.length !== HALF_ROWS * 8 || GRADIENT.floor.length !== HALF_ROWS * 8) throw new Error('GRADIENT must cover each half');

// Bricks only on walls with j (half height / 2) at least TEX_NEAR; 0 for every wall. 20 (about 3
// tiles) was tried: 5% faster, but bricks popped in too close. See below.
const TEX_NEAR = 0;
// Rays are 2 angle units apart (a 56.25 degree view), so a turn (4 units a tick) shifts them by 2 and
// the engine keeps the ones it has. Scale 160 kept walls and objects in proportion at that width, but
// was slower (further fog, more sprites) and looked no better than 120.
const caster = APEXRAY.makeCaster({ rays: 80, angleStep: 2, scale: 120, maxH: HALF_ROWS * 8, even: true, interpolate: 4, fog: DARK, uNear: TEX_NEAR - 4 });

// Bricks (multicolor only). A wall of half height h = 2j is 4 courses of bricks, mirrored about the
// horizon (80) so the bottom half is the top half upside down: mortar lines at 80 - j and 80 + j, and
// a double line either side of the horizon. Joints sit at u = 0 and 128 on the outer courses and 64
// and 192 on the inner two. Rays nearer than TEX_NEAR (in j) carry u; others have plain walls.
//
// Cells that are solid wall of one shade for both rays get brick glyphs, other cells the raycast set's.
// In a brick cell the left ray's strip is plain, a joint, or has a mortar line at line 1, 3, 5 or 7
// (rounded up to odd) that runs across the whole cell; the right ray's strip is plain or a joint.
// Mortar is the other wall shade. A ray is a joint on a course when a multiple of 64 of that parity
// lies between its u and the next ray's (the same face, both with u; the last ray extrapolates).
//
// The engine works from one byte per ray, stored = j + 41 * (shadeB + 2 * joint), where joint is 0, 1
// (an outer-course joint) or 2 (inner). Per row, tables give the left ray's state (0-18) and the right
// ray's (0-10), and PAIRT / PAIRB[11 * left + right] the top and bottom screen codes; see c64/gen.js.
// The brick glyphs go at the start of the set, which the view never uses, except $20: the status
// panel's first line is spaces, and the font switch can land a few cycles into it, so $20 stays blank.
const TEX_CODES = Array.from({ length: 44 }, (_, i) => (i < 0x20 ? i : i + 1));
const PLAIN = 0, JOINT = 5; // left strip types; 1-4 are a mortar line at line 1, 3, 5, 7

const sameFace = (a, b) => a.mapX === b.mapX && a.mapY === b.mapY && a.side === b.side;
function jointCodes(rays) {
  return rays.map((r, c) => {
    if (!r.u) return 0;
    let lo = r.u, hi;
    if (c + 1 < rays.length) { if (!sameFace(r, rays[c + 1])) return 0; hi = rays[c + 1].u; }
    else { if (!sameFace(r, rays[c - 1])) return 0; hi = Math.max(0, Math.min(255, 2 * r.u - rays[c - 1].u)); }
    if (hi < lo) [lo, hi] = [hi, lo];
    const ga = (lo + 63) >> 6, gb = (hi + 63) >> 6;
    return ga === gb ? 0 : 1 + (ga & 1);
  });
}

// A ray's strip type in row b (0 = next to the horizon) of either half, when the cell is solid wall:
// a mortar line (1-4), else a joint on this cell's course, else plain.
function stripType(b, j, joint) {
  if (j < TEX_NEAR) return PLAIN;
  let line = -1;
  if (j >= 8 * b + 1 && j <= 8 * b + 8) line = 8 * b + 8 - j;
  else if (b === 0) line = 7;
  if (line >= 0) return 1 + (line >> 1);
  const course = Math.floor((2 * j - 8 * b - 4) / j);
  return joint === 1 + (course & 1) ? JOINT : PLAIN;
}
// Left states: 0 empty, 1-3 shade A wall end 2/4/6 pixels, 4-6 shade B, 7-12 solid A by strip type,
// 13-18 solid B. Right states: the same up to 6, then 7/8 solid A plain/joint, 9/10 solid B.
function leftState(b, j, shadeB, joint) {
  const rem = 2 * j - 8 * b;
  if (rem <= 0) return 0;
  if (rem < 8) return 1 + 3 * shadeB + (rem >> 1) - 1;
  return 7 + 6 * shadeB + stripType(b, j, joint);
}
function rightState(b, j, shadeB, joint) {
  const s = leftState(b, j, shadeB, joint);
  return s < 7 ? s : 7 + 2 * shadeB + ((s - 7) % 6 === JOINT ? 1 : 0);
}
// The brick glyph for a shade and left / right strip types (the top half's way up), and its code;
// the bottom half's are the same upside down, 22 codes on.
const texCode = (top, shadeB, tl, tr) => TEX_CODES[(top ? 0 : 22) + 11 * shadeB + 2 * tl + tr - 1];
function texGlyph(top, shadeB, tl, tr) {
  const wall = shadeB ? 3 : 2, mortar = 5 - wall;
  const g = Array.from({ length: 8 }, (_, line) => {
    const across = tl >= 1 && tl <= 4 && line === 2 * tl - 1;
    const L = tl === JOINT || across ? mortar : wall, R = tr === 1 || across ? mortar : wall;
    return (L << 6) | (L << 4) | (R << 2) | R;
  });
  return Uint8Array.from(top ? g : g.reverse());
}
// The screen code for a cell from its left and right states.
function pairCode(top, sl, sr) {
  const fullL = sl >= 7, fullR = sr >= 7;
  const shL = fullL ? +(sl >= 13) : +(sl >= 4), shR = fullR ? +(sr >= 9) : +(sr >= 4);
  if (fullL && fullR && shL === shR) {
    const tl = (sl - 7) % 6, tr = (sr - 7) & 1;
    if (tl || tr) return texCode(top, shL, tl, tr);
  }
  const old = (s, full, sh) => (s === 0 ? 0 : RAY.state(sh, full ? 8 : 2 * (s - 3 * sh)));
  return (top ? RAY.top : RAY.bottom) + 9 * old(sl, fullL, shL) + old(sr, fullR, shR);
}
// The multicolor raycast set with the brick glyphs added.
function charset() {
  const chars = APEXSCII.buildDefault('mc', 'ray').glyphs.map(g => Uint8Array.from(g));
  for (const top of [true, false]) for (let sh = 0; sh < 2; sh++) for (let tl = 0; tl < 6; tl++) for (let tr = 0; tr < 2; tr++)
    if (tl || tr) chars[texCode(top, sh, tl, tr)] = texGlyph(top, sh, tl, tr);
  return chars;
}

// The screen codes for one frame of rays (80 entries from cast()); bricks when textured.
function viewCodes(rays, textured = false) {
  const screen = new Uint8Array(VIEW_ROWS * 40);
  const state = (ray, below) => RAY.state(ray.side === 0 ? 1 : 0, Math.max(0, Math.min(8, ray.halfH - 8 * below)));
  const joints = textured && jointCodes(rays);
  for (let cx = 0; cx < 40; cx++) {
    const L = rays[2 * cx], R = rays[2 * cx + 1];
    const d = (ray, k) => [ray.halfH >> 1, ray.side === 0 ? 1 : 0, joints[k]];
    for (let r = 0; r < HALF_ROWS; r++) {
      if (textured) {
        const sl = leftState(r, ...d(L, 2 * cx)), sr = rightState(r, ...d(R, 2 * cx + 1));
        screen[(HALF_ROWS - 1 - r) * 40 + cx] = pairCode(true, sl, sr);
        screen[(HALF_ROWS + r) * 40 + cx] = pairCode(false, sl, sr);
        continue;
      }
      const sl = state(L, r), sr = state(R, r), code = 9 * sl + sr;
      screen[(HALF_ROWS - 1 - r) * 40 + cx] = RAY.top + code;
      screen[(HALF_ROWS + r) * 40 + cx] = RAY.bottom + code;
    }
  }
  return screen;
}

// A whole 40x25 frame: the view, the map's objects as sprites, and the status panel. status: up to 5
// lines of text, where {...} is shown in reverse video.
function frame(map, player, mode = 'mc', status = []) {
  const C = COLOURS[mode], mc = mode === 'mc';
  const screen = new Uint8Array(1000).fill(0x20), color = new Uint8Array(1000).fill(C.text);
  const rays = caster.cast(map, player.x, player.y, player.a);
  screen.set(viewCodes(rays, mc));
  const sprites = SPRITES.place(caster, rays, map.objects || [], player, { horizon: HALF_ROWS * 8, rows: VIEW_ROWS * 8, pxPerRay: 4 });
  color.fill(mc ? 8 | C.wallB : C.ink, 0, VIEW_ROWS * 40);
  status.slice(0, STATUS_ROWS).forEach((line, k) => {
    let col = 1, rev = false;
    for (const ch of line) {
      if (ch === '{' || ch === '}') { rev = ch === '{'; continue; }
      if (col > 39) break;
      const at = (VIEW_ROWS + k) * 40 + col++;
      screen[at] = APEXSCII.asciiToScreen(ch) | (rev ? 0x80 : 0);
      color[at] = rev ? C.accent : C.text;
    }
  });
  const chars = mc ? charset() : APEXSCII.buildDefault(mode, 'ray').glyphs;
  const opts = mc
    ? { mode, bg: C.bg, mc1: C.mc1, mc2: C.mc2, border: C.border, romRows: STATUS_ROWS }
    : { mode, bg: C.bg, border: C.border, romRows: STATUS_ROWS };
  return {
    chars, screen, color, opts, sprites,
    prg: () => SPRITES.prg(chars, screen, color, opts, sprites),
    rgba: (rom, engine = false) => {
      const px = APEXSCII.screenRGB(chars, screen, color, opts, rom);
      if (!engine || !mc) return SPRITES.overlay(px, sprites);
      shade(px, chars, screen, color);
      return narrow(SPRITES.overlay(px, sprites), C.border);
    },
  };
}

// Repaints the view's ceiling and floor pixels (multicolor codes 00 and 01) with GRADIENT.
const PAL = APEXSCII.PALETTE.map(h => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16)));
function shade(px, chars, screen, color) {
  for (let cy = 0; cy < VIEW_ROWS; cy++) for (let cx = 0; cx < 40; cx++) {
    const k = cy * 40 + cx, g = chars[screen[k]];
    if (!(color[k] & 8)) continue;
    for (let y = 0; y < 8; y++) {
      const line = cy * 8 + y;
      for (let x = 0; x < 8; x++) {
        const v = (g[y] >> (6 - 2 * (x >> 1))) & 3;
        if (v > 1) continue;
        const c = PAL[v ? GRADIENT.floor[line - HALF_ROWS * 8] : GRADIENT.ceiling[line]], p = (line * 320 + cx * 8 + x) * 4;
        px[p] = c[0]; px[p + 1] = c[1]; px[p + 2] = c[2];
      }
    }
  }
}

// 38-column mode: the border covers x 0-6 and 311-319.
function narrow(px, border) {
  const c = PAL[border];
  for (let y = 0; y < 200; y++) for (let x = 0; x < 320; x++) {
    if (x >= 7 && x < 311) continue;
    const p = (y * 320 + x) * 4;
    px[p] = c[0]; px[p + 1] = c[1]; px[p + 2] = c[2];
  }
  return px;
}

// The status panel the showcase and tests use.
function statusLines(map, p) {
  const num = v => (v / 256).toFixed(1).padStart(4, '0');
  const deg = String(Math.round((p.a * 360) / 1024) % 360).padStart(3, '0');
  return ['', `{ APEX } ${map.name.toUpperCase()}`, '', `X ${num(p.x)}  Y ${num(p.y)}  HEADING ${deg}`, ''];
}

module.exports = { VIEW_ROWS, STATUS_ROWS, COLOURS, DARK, GRADIENT, caster, viewCodes, frame, statusLines,
  TEX_NEAR, charset, leftState, rightState, pairCode };
