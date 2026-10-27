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
const GRADIENT = {
  ceiling: shades([[12, 24], [12, 11, 8], [11, 24], [11, 0, 8], [0, 16]]),
  floor: shades([[0, 16], [0, 11, 8], [11, 32], [11, 12, 8], [12, 16]]),
};
if (GRADIENT.ceiling.length !== HALF_ROWS * 8 || GRADIENT.floor.length !== HALF_ROWS * 8) throw new Error('GRADIENT must cover each half');

const caster = APEXRAY.makeCaster({ rays: 80, fov: 66, scale: 120, maxH: HALF_ROWS * 8, even: true, interpolate: true });

// The screen codes for one frame of rays (80 entries from cast()).
function viewCodes(rays) {
  const screen = new Uint8Array(VIEW_ROWS * 40);
  const state = (ray, below) => RAY.state(ray.side === 0 ? 1 : 0, Math.max(0, Math.min(8, ray.halfH - 8 * below)));
  for (let cx = 0; cx < 40; cx++) {
    const L = rays[2 * cx], R = rays[2 * cx + 1];
    for (let r = 0; r < HALF_ROWS; r++) {
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
  screen.set(viewCodes(rays));
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
  const chars = APEXSCII.buildDefault(mode, 'ray').glyphs;
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

module.exports = { VIEW_ROWS, STATUS_ROWS, COLOURS, GRADIENT, caster, viewCodes, frame, statusLines };
