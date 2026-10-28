/*
 * The C64 isometric dungeon view: what the screen shows each frame, exactly as the engine is to show it.
 *
 * Multicolor characters, 38 columns by 24 rows, scrolled in both directions by the VIC's fine scroll so
 * the hero stays at the centre (a hardware sprite that never moves). Tiles are 32x16 pixel diamonds;
 * walls are cubes 16 pixels high. Every character of the screen shows the part of the dungeon under
 * it, and with tiles on a 2:1 grid that part depends on at most 4 tiles: which 4 depends on where the
 * character sits on the grid (its phase, 0-3), and the character is a table lookup by phase and those
 * tiles' kinds. The whole dungeon takes a few dozen characters.
 *
 * Light: the bit pair 11 of every character is the light's colour, which comes from colour RAM. Colour
 * RAM never changes: it holds rings around the hero, so the light is fixed on the screen and the
 * dungeon moves under it. The other bit pairs ($D021 void and joints, $D023 mortar) are the same
 * everywhere, so the dungeon's shape stays faintly visible in the dark.
 *
 * Works in Node and in the browser (global APEXISOVIEW, needing APEXSCII and APEXISO).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../../apexscii/apexscii.js'), require('../../core/iso.js'));
  else root.APEXISOVIEW = factory(root.APEXSCII, root.APEXISO);
})(typeof self !== 'undefined' ? self : this, function (APEXSCII, ISO) {
  'use strict';

  const WALL_H = 16; // a wall's height in pixels
  const COLS = 38, ROWS = 24; // what the 38-column, 24-row screen shows
  // The visible window: X 7-310, Y 4-195 of the 320x200 display. The hero's feet are always at HERO.
  const HERO = { x: 158, y: 112 };
  const COLORS = { border: 0, bg: 0, mc1: 9, mc2: 11 }; // $D020, $D021 void and joints, $D022 (unused), $D023 mortar
  // The light: colour RAM (0-7) by distance from the hero, in rings out to the dark.
  const LIGHT = { center: { x: HERO.x, y: HERO.y - 10 }, rings: [[72, 7], [116, 2]], dark: 0 };

  // ------------------------------------------------------------------ geometry
  // Screen-plane pixel (sx, sy) -> world (in tiles): sx = 16 (wx - wy), sy = 8 (wx + wy).
  const inv = (sx, sy) => [(sx / 16 + sy / 8) / 2, (sy / 8 - sx / 16) / 2];
  // What's at a screen-plane point: the nearest wall face, else the floor. { f: E void, G floor,
  // T wall top, L wall's lit side, R wall's shaded side; t: which tile }
  function surface(kind, sx, sy) {
    const [wx, wy] = inv(sx, sy), bx = Math.floor(wx), by = Math.floor(wy);
    let best = null, depth = -Infinity;
    for (let ty = by - 1; ty <= by + 3; ty++) for (let tx = bx - 1; tx <= bx + 3; tx++) {
      if (kind(tx, ty) !== ISO.WALL || tx + ty <= depth) continue;
      let f = null;
      const [ux, uy] = inv(sx, sy + WALL_H);
      if (Math.floor(ux) === tx && Math.floor(uy) === ty) f = 'T';
      else {
        const u = sx / 16 + ty + 1; // on the lower-left edge's face?
        if (u >= tx && u < tx + 1 && sy >= 8 * (u + ty + 1) - WALL_H && sy < 8 * (u + ty + 1)) f = 'L';
        const v = tx + 1 - sx / 16; // the lower-right edge's?
        if (!f && v >= ty && v < ty + 1 && sy >= 8 * (tx + 1 + v) - WALL_H && sy < 8 * (tx + 1 + v)) f = 'R';
      }
      if (f) { best = { f, t: tx + ',' + ty }; depth = tx + ty; }
    }
    if (best) return best;
    return { f: kind(bx, by) === ISO.FLOOR ? 'G' : 'E', t: bx + ',' + by };
  }

  // A screen-plane character (cx, cy) covers pixels 8cx.. x 8cy..; its phase and anchor tile.
  const phaseOf = (cx, cy) => (cx + 2 * cy) & 3;
  const anchorOf = (cx, cy) => [(2 * (cx + 2 * cy) + 3) >> 3, (2 * (2 * cy - cx) + 1) >> 3];
  // The character's fat pixel samples.
  const sample = (cx, cy, f, y) => [8 * cx + 2 * f + 1, 8 * cy + y + 0.5];

  // REL[phase]: the four tiles (from the anchor) that can show in a character of that phase, found by
  // changing one tile at a time; the first two can show as floor or void too, the last two only as walls.
  const REL = [0, 1, 2, 3].map(p => {
    const [ax, ay] = anchorOf(p, 0), floors = [], walls = [];
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const looks = new Set();
      for (const k of [ISO.VOID, ISO.FLOOR, ISO.WALL]) {
        const kind = (x, y) => (x === ax + dx && y === ay + dy ? k : ISO.FLOOR);
        let s = '';
        for (let y = 0; y < 8; y++) for (let f = 0; f < 4; f++) s += surface(kind, ...sample(p, 0, f, y)).f;
        looks.add(s);
      }
      if (looks.size === 3) floors.push([dx, dy]);
      else if (looks.size === 2) walls.push([dx, dy]);
    }
    if (floors.length !== 2 || walls.length !== 2) throw new Error(`phase ${p}: expected 2 floor and 2 wall tiles`);
    return [...floors, ...walls];
  });
  // A character's pattern: kinds of its REL tiles, a + 3 b + 9 (c is wall) + 18 (d is wall): 0-35.
  const PATTERNS = 36;
  function patternOf(M, cx, cy) {
    const p = phaseOf(cx, cy), [ax, ay] = anchorOf(cx, cy), r = REL[p];
    const k = i => ISO.tileAt(M, ax + r[i][0], ay + r[i][1]);
    return k(0) + 3 * k(1) + 9 * (k(2) === ISO.WALL) + 18 * (k(3) === ISO.WALL);
  }

  // ------------------------------------------------------------------ textures
  // Fat pixels (4 x 8, tiled every character): 0 void and joints, 1 ($D022, unused so far), 2 mortar ($D023),
  // 3 light (colour RAM). Floor joints (0) are drawn where one floor tile meets another, and a wall's
  // top is edged in mortar, so in the dark only the walls' mortar shows.
  const tex = rows => (f, y) => +rows[y][f];
  const TEX = {
    E: tex(['0000', '0000', '0000', '0000', '0000', '0000', '0000', '0000']),
    G: tex(['3333', '3303', '3333', '3333', '3033', '3333', '3333', '3333']),
    T: tex(['3333', '3333', '3333', '3333', '3333', '3333', '3333', '3333']),
    L: tex(['2222', '3323', '3323', '3323', '2222', '2333', '2333', '2333']),
    R: tex(['2222', '3032', '0302', '3032', '2222', '2303', '2030', '2303']),
  };

  // ------------------------------------------------------------------ characters
  const base = APEXSCII.buildDefault('mc', 'iso', 'crypt');
  const chars = base.glyphs.map(g => Uint8Array.from(g));
  const FREE = [];
  for (const r of base.regions) if (r.name === 'free') for (let c = r.from; c <= r.to; c++) FREE.push(c);
  const glyphCodes = new Map();
  let nextFree = 0;
  function glyph(bytes) {
    const key = bytes.join(',');
    if (glyphCodes.has(key)) return glyphCodes.get(key);
    if (nextFree >= FREE.length) throw new Error('out of characters');
    const code = FREE[nextFree++];
    chars[code] = Uint8Array.from(bytes);
    glyphCodes.set(key, code);
    return code;
  }
  // CODES[phase * 36 + pattern]: the character, drawn from the faces at each fat pixel.
  const CODES = new Uint8Array(4 * PATTERNS);
  for (let p = 0; p < 4; p++) {
    const [ax, ay] = anchorOf(p, 0);
    for (let n = 0; n < PATTERNS; n++) {
      const k = [n % 3, Math.floor(n / 3) % 3, Math.floor(n / 9) % 2 ? ISO.WALL : ISO.FLOOR, Math.floor(n / 18) ? ISO.WALL : ISO.FLOOR];
      const kind = (x, y) => { for (let i = 0; i < 4; i++) if (x === ax + REL[p][i][0] && y === ay + REL[p][i][1]) return k[i]; return ISO.FLOOR; };
      const s = [];
      for (let y = 0; y < 8; y++) for (let f = 0; f < 4; f++) s.push(surface(kind, ...sample(p, 0, f, y)));
      const bytes = [];
      for (let y = 0; y < 8; y++) {
        let b = 0;
        for (let f = 0; f < 4; f++) {
          const here = s[y * 4 + f];
          let v = TEX[here.f](f, y);
          // a floor joint: the floor tile above or to the left is another tile
          const near = [f ? s[y * 4 + f - 1] : null, y ? s[(y - 1) * 4 + f] : null, f < 3 ? s[y * 4 + f + 1] : null, y < 7 ? s[(y + 1) * 4 + f] : null];
          if (here.f === 'G') for (const o of near.slice(0, 2)) if (o && o.f === 'G' && o.t !== here.t) v = 0;
          if (here.f === 'T') for (const o of near) if (o && (o.f !== 'T' || o.t !== here.t)) v = 2;
          b |= v << (6 - 2 * f);
        }
        bytes.push(b);
      }
      CODES[p * PATTERNS + n] = glyph(bytes);
    }
  }
  const codeAt = (M, cx, cy) => CODES[phaseOf(cx, cy) * PATTERNS + patternOf(M, cx, cy)];

  // ------------------------------------------------------------------ the light
  // Colour RAM for the 40 x 25 screen: each character's ring by its centre's distance from the light
  // (vertical distance counts double, as the floor is squashed 2:1). Between rings, a checkerboard.
  const LIGHT_RAM = new Uint8Array(1000);
  for (let r = 0; r < 25; r++) for (let c = 0; c < 40; c++) {
    const dx = 8 * c + 8 - LIGHT.center.x, dy = 2 * (8 * r + 4 - LIGHT.center.y), d = Math.hypot(dx, dy);
    let col = LIGHT.dark;
    for (let i = LIGHT.rings.length - 1; i >= 0; i--) {
      const [rad, colour] = LIGHT.rings[i];
      if (d < rad - 6) col = colour;
      else if (d < rad + 6 && ((r + c) & 1)) col = colour;
    }
    LIGHT_RAM[r * 40 + c] = col;
  }

  // ------------------------------------------------------------------ scrolling
  // The camera is the screen-plane pixel at the display's top left. The VIC shows screen matrix
  // column c from X = 8c + xs and row r from Y = 8r + ys - 3 (xs, ys: the fine scroll registers), so
  // the matrix starts at screen-plane character (cX, cY).
  function scroll(h) {
    const s = ISO.screen(h), camX = s.x - HERO.x, camY = s.y - HERO.y;
    const xs = -camX & 7, ys = (3 - camY) & 7;
    return { camX, camY, xs, ys, cX: (camX + xs) >> 3, cY: (camY + ys - 3) >> 3 };
  }

  // ------------------------------------------------------------------ the hero's sprite
  // 12 fat pixels by 21 rows, facing right: a armour (sprite colour), c cloak ($D025), w steel and
  // skin ($D026).
  const SPRITE = { mc1: 2, mc2: 1, color: 15 };
  const BODY = [
    '....aaaa....', '...aaaaaa...', '...awwwwa...', '...aaaaaa...', '....aaaa....', '..cccaaccc..',
    '.ccaaaaaacc.', '.caaaaaaaac.', '.caawaaaaacw', '.caaaaaaaacw', '..cawaaaa.cw', '..ccaaaacc.w',
    '...aaaaaa..w', '...ccccccc..',
  ];
  const LEGS = {
    stand: ['...aa..aa...', '...aa..aa...', '...aa..aa...', '...aa..aa...', '...aa..aa...', '..www..www..', '............'],
    walk1: ['...aa...aa..', '..aa....aa..', '..aa.....aa.', '.aa......aa.', '.www.....www', '............', '............'],
    walk2: ['....aaaa....', '....aaa.....', '.....aa.....', '.....aa.....', '....www.....', '............', '............'],
  };
  const FRAMES = {};
  for (const [name, legs] of Object.entries(LEGS)) {
    const rows = [...BODY, ...legs].map(r => Array.from(r, ch => ({ c: 1, a: 2, w: 3 }[ch] || 0)));
    while (rows[rows.length - 1].every(v => !v)) rows.pop();
    while (rows.length < 21) rows.unshift(new Array(12).fill(0));
    FRAMES[name] = rows.slice(-21);
  }
  const spriteFrame = h => (!h.moving ? 'stand' : (h.frame >> 2) & 1 ? 'walk2' : 'walk1');

  // ------------------------------------------------------------------ a frame
  const PAL = APEXSCII.PALETTE.map(hx => [1, 3, 5].map(i => parseInt(hx.substr(i, 2), 16)));
  // What the screen shows: { pixels (320x200 RGBA, the border drawn), scroll }.
  function frame(M, h) {
    const out = new Uint8ClampedArray(320 * 200 * 4);
    const put = (x, y, c) => { const i = (y * 320 + x) * 4; out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2]; out[i + 3] = 255; };
    const sc = scroll(h);
    for (let r = 0; r < 25; r++) for (let c = 0; c < 39; c++) {
      const g = chars[codeAt(M, sc.cX + c, sc.cY + r)], cols = [COLORS.bg, COLORS.mc1, COLORS.mc2, LIGHT_RAM[r * 40 + c]];
      for (let y = 0; y < 8; y++) {
        const Y = 8 * r + y + sc.ys - 3;
        if (Y < 0 || Y >= 200) continue;
        for (let x = 0; x < 8; x++) {
          const X = 8 * c + x + sc.xs;
          if (X < 320) put(X, Y, PAL[cols[(g[y] >> (6 - 2 * (x >> 1))) & 3]]);
        }
      }
    }
    // the hero: feet at HERO, centred across
    const f = FRAMES[spriteFrame(h)], scols = [null, SPRITE.mc1, SPRITE.color, SPRITE.mc2];
    for (let r = 0; r < 21; r++) for (let c = 0; c < 12; c++) {
      const v = f[r][h.facing < 0 ? 11 - c : c];
      if (v) for (const dx of [0, 1]) put(HERO.x - 12 + 2 * c + dx, HERO.y - 20 + r, PAL[scols[v]]);
    }
    for (let y = 0; y < 200; y++) for (let x = 0; x < 320; x++) if (x < 7 || x >= 311 || y < 4 || y >= 196) put(x, y, PAL[COLORS.border]);
    return { pixels: out, scroll: sc };
  }

  return { WALL_H, COLS, ROWS, HERO, COLORS, LIGHT, LIGHT_RAM, REL, PATTERNS, CODES, chars, FREE, glyphsUsed: () => nextFree,
    phaseOf, anchorOf, patternOf, codeAt, surface, scroll, SPRITE, FRAMES, spriteFrame, frame };
});
