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

const caster = APEXRAY.makeCaster({ rays: 80, fov: 66, scale: 120, maxH: HALF_ROWS * 8, even: true });

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
    rgba: rom => SPRITES.overlay(APEXSCII.screenRGB(chars, screen, color, opts, rom), sprites),
  };
}

// The status panel the showcase and tests use.
function statusLines(map, p) {
  const num = v => (v / 256).toFixed(1).padStart(4, '0');
  const deg = String(Math.round((p.a * 360) / 1024) % 360).padStart(3, '0');
  return ['', `{ APEX } ${map.name.toUpperCase()}`, '', `X ${num(p.x)}  Y ${num(p.y)}  HEADING ${deg}`, ''];
}

module.exports = { VIEW_ROWS, STATUS_ROWS, COLOURS, caster, viewCodes, frame, statusLines };
