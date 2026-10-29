/*
 * The C64 isometric dungeon view: what the screen shows each frame, exactly as the engine is to show it.
 *
 * Multicolor characters, 38 columns by 24 rows, scrolled in both directions by the VIC's fine scroll so
 * the hero stays at the centre (a hardware sprite that never moves). Tiles are 32x16 pixel diamonds;
 * walls are cubes 16 pixels high. Every character of the screen shows the part of the dungeon under
 * it, and with tiles on a 2:1 grid that part depends on at most 4 tiles: which 4 depends on where the
 * character sits on the grid (its phase, 0-3), and the character is a table lookup by phase and those
 * tiles' looks (void, floor, cracked floor, wall, wall with a torch). Textures are laid out on each
 * tile (flagstones, brick courses along the walls), so the phase also fixes which part of a tile a
 * character shows. Only the cases a map uses get characters, at most 128.
 *
 * Light, in two parts that never change while the dungeon scrolls under them:
 *   - colour RAM gives bit pair 11 (the lit stone) its colour in rings around the hero: yellow, red, black
 *   - each character comes twice: as itself, and half-lit (its lit stone thinned by a dither). The
 *     screen codes' bit 7 picks the half-lit one, again in rings, fixed on the screen
 * Together they make five steps from full light to dark, blended by ordered dithering. The other bit
 * pairs are fixed colours: $D021 black (void, floor joints), $D022 white (torch flames, which glow in
 * the dark), $D023 dark grey (mortar, so walls stay faintly visible in the dark).
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
  const COLORS = { border: 0, bg: 0, mc1: 1, mc2: 11 }; // $D020, $D021 void and joints, $D022 flames, $D023 mortar
  // The light's steps, brightest first: [colour RAM, half-lit]. A character's step is its distance
  // from the light (vertical distance counts double: the floor is squashed 2:1), past FULL, in steps
  // of STEP pixels, dithered with a 2x2 ordered pattern.
  const LIGHT = { center: { x: HERO.x, y: HERO.y - 10 }, full: 52, step: 20, steps: [[7, 0], [7, 1], [2, 0], [2, 1], [0, 0]] };

  // ------------------------------------------------------------------ geometry
  // A tile's look: 0 void, 1 floor, 2 cracked floor, 3 wall, 4 wall with a torch.
  const lookAt = (M, tx, ty) => {
    const k = ISO.tileAt(M, tx, ty), d = ISO.decoAt(M, tx, ty);
    return k === ISO.FLOOR ? 1 + d : k === ISO.WALL ? 3 + d : 0;
  };
  // Screen-plane pixel (sx, sy) -> world (in tiles): sx = 16 (wx - wy), sy = 8 (wx + wy).
  const inv = (sx, sy) => [(sx / 16 + sy / 8) / 2, (sy / 8 - sx / 16) / 2];
  // What's at a screen-plane point: the nearest wall face, else the floor. { f: E void, G floor,
  // T wall top, L wall's lit side, R wall's shaded side; t: the tile; look; where on the tile: a, b
  // across a floor or top, along and h (height) up a side }
  function surface(look, sx, sy) {
    const [wx, wy] = inv(sx, sy), bx = Math.floor(wx), by = Math.floor(wy);
    let best = null, depth = -Infinity;
    for (let ty = by - 1; ty <= by + 3; ty++) for (let tx = bx - 1; tx <= bx + 3; tx++) {
      const lk = look(tx, ty);
      if (lk < 3 || tx + ty <= depth) continue;
      const t = tx + ',' + ty, [ux, uy] = inv(sx, sy + WALL_H);
      let s = null;
      if (Math.floor(ux) === tx && Math.floor(uy) === ty) s = { f: 'T', a: ux - tx, b: uy - ty };
      else {
        const u = sx / 16 + ty + 1, hu = 8 * (u + ty + 1) - sy; // on the lower-left edge's face?
        if (u >= tx && u < tx + 1 && hu > 0 && hu <= WALL_H) s = { f: 'L', along: u - tx, h: hu };
        const v = tx + 1 - sx / 16, hv = 8 * (tx + 1 + v) - sy; // the lower-right edge's?
        if (!s && v >= ty && v < ty + 1 && hv > 0 && hv <= WALL_H) s = { f: 'R', along: ty + 1 - v, h: hv };
      }
      if (s) { best = Object.assign(s, { t, look: lk }); depth = tx + ty; }
    }
    if (best) return best;
    const lk = look(bx, by);
    return lk ? { f: 'G', t: bx + ',' + by, look: lk, a: wx - bx, b: wy - by } : { f: 'E', t: bx + ',' + by, look: 0 };
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
      const kinds = new Set();
      for (const k of [0, 1, 3]) {
        const look = (x, y) => (x === ax + dx && y === ay + dy ? k : 1);
        let s = '';
        for (let y = 0; y < 8; y++) for (let f = 0; f < 4; f++) s += surface(look, ...sample(p, 0, f, y)).f;
        kinds.add(s);
      }
      if (kinds.size === 3) floors.push([dx, dy]);
      else if (kinds.size === 2) walls.push([dx, dy]);
    }
    if (floors.length !== 2 || walls.length !== 2) throw new Error(`phase ${p}: expected 2 floor and 2 wall tiles`);
    return [...floors, ...walls];
  });
  // A character's pattern: the looks of its REL tiles, l0 + 5 l1 + 25 w2 + 75 w3 (0-224), where w is
  // 0 not a wall, 1 wall, 2 wall with a torch.
  const PATTERNS = 225;
  const wallOf = lk => (lk >= 3 ? lk - 2 : 0);
  function patternOf(M, cx, cy) {
    const p = phaseOf(cx, cy), [ax, ay] = anchorOf(cx, cy), r = REL[p];
    const lk = i => lookAt(M, ax + r[i][0], ay + r[i][1]);
    return lk(0) + 5 * lk(1) + 25 * wallOf(lk(2)) + 75 * wallOf(lk(3));
  }

  // ------------------------------------------------------------------ textures
  // Fat pixels: 0 black, 1 flame ($D022), 2 mortar ($D023), 3 lit stone (colour RAM). Each surface
  // is split into regions (a floor tile, a wall's bricks in two courses along its sides) and a joint
  // or mortar line is drawn where a region meets the one above it, or beside it on a wall.
  function region(s) {
    switch (s.f) {
      case 'G': case 'T': return s.f + s.t;
      case 'L': case 'R': {
        const course = Math.floor((s.h - 0.5) / 8);
        return `${s.f}${s.t}:${course}:${Math.floor(2 * s.along + (course & 1) / 2)}`;
      }
      default: return 'E';
    }
  }
  function shade(s, f, y, left, up) {
    const id = region(s), meets = n => n && region(n) !== id;
    if (s.f === 'E') return 0;
    if (s.f === 'G') {
      if (up && up.f === 'G' && meets(up)) return 0; // a joint between tiles
      if (up && (up.f === 'L' || up.f === 'R')) return 0; // the shadow at a wall's foot
      if (s.look === 2 && Math.abs(s.a - 0.5 - (s.b - 0.5) * 0.6) < 0.05 && s.b > 0.15 && s.b < 0.85) return 0; // a crack
      if (s.look === 2 && s.a > 0.6 && s.b < 0.35) return (f + y) & 1 ? 0 : 3; // and broken stone
      return 3;
    }
    if (s.f === 'T') return [left, up].some(meets) || (f + y) & 1 ? 2 : 3; // half mortar: darker than the floor
    // a wall's side: a torch, else bricks
    if (s.look === 4) {
      const c = Math.abs(s.along - 0.5) * 16; // pixels from the middle
      if (c < 2 && s.h >= 7 && s.h < 12) return 1;
      if (c < 1 && s.h >= 12 && s.h < 13) return 1;
      if (c < 2 && s.h >= 4 && s.h < 7) return 0;
    }
    if ([left, up].some(n => n && n.f === s.f && n.t === s.t && meets(n))) return 2;
    return s.f === 'R' && y & 1 ? 0 : 3;
  }
  // Half-lit: lit stone thinned to a checkerboard of fat pixels.
  const halfLit = (v, f, y) => (v === 3 && (f + y) & 1 ? 0 : v);

  // The character for a phase and pattern: 8 bytes, as itself and half-lit.
  function draw(p, n) {
    const [ax, ay] = anchorOf(p, 0), lk = [n % 5, Math.floor(n / 5) % 5];
    const w = [Math.floor(n / 25) % 3, Math.floor(n / 75)].map(v => (v ? v + 2 : 1));
    const looks = [...lk, ...w];
    const look = (x, y) => { for (let i = 0; i < 4; i++) if (x === ax + REL[p][i][0] && y === ay + REL[p][i][1]) return looks[i]; return 1; };
    const s = [];
    for (let y = 0; y < 8; y++) for (let f = 0; f < 4; f++) s.push(surface(look, ...sample(p, 0, f, y)));
    const v = [];
    for (let y = 0; y < 8; y++) for (let f = 0; f < 4; f++) v.push(shade(s[y * 4 + f], f, y, f ? s[y * 4 + f - 1] : null, y ? s[(y - 1) * 4 + f] : null));
    const bytes = half => Array.from({ length: 8 }, (_, y) => {
      let b = 0;
      for (let f = 0; f < 4; f++) b |= (half ? halfLit(v[y * 4 + f], f, y) : v[y * 4 + f]) << (6 - 2 * f);
      return b;
    });
    return { full: bytes(false), half: bytes(true) };
  }

  // ------------------------------------------------------------------ a map's characters
  // Characters 0-127 are the patterns the map uses (sharing any that look the same); 128-255 are the
  // same, half-lit. codes[phase * 225 + pattern] is a pattern's character, -1 where the map never
  // shows it.
  const prepared = new WeakMap();
  function prepare(M) {
    if (prepared.has(M)) return prepared.get(M);
    const used = new Set();
    // every character the map can show, with a margin for the walls' height
    for (let cy = -2; cy <= M.w + M.h + 4; cy++) for (let cx = -2 * M.h - 4; cx <= 2 * M.w + 4; cx++)
      used.add(phaseOf(cx, cy) * PATTERNS + patternOf(M, cx, cy));
    for (let p = 0; p < 4; p++) used.add(p * PATTERNS); // all void
    const chars = Array.from({ length: 256 }, () => new Uint8Array(8)), codes = new Int16Array(4 * PATTERNS).fill(-1);
    const byLook = new Map();
    for (const i of [...used].sort((a, b) => a - b)) {
      const g = draw(Math.floor(i / PATTERNS), i % PATTERNS), key = g.full.join(',');
      if (!byLook.has(key)) {
        const code = byLook.size;
        if (code >= 128) throw new Error(`${M.name}: more than 128 characters`);
        chars[code] = Uint8Array.from(g.full);
        chars[code + 128] = Uint8Array.from(g.half);
        byLook.set(key, code);
      }
      codes[i] = byLook.get(key);
    }
    const P = {
      chars, codes, count: byLook.size,
      codeAt: (cx, cy) => {
        const c = codes[phaseOf(cx, cy) * PATTERNS + patternOf(M, cx, cy)];
        if (c < 0) throw new Error(`no character for ${cx},${cy}`);
        return c;
      },
    };
    prepared.set(M, P);
    return P;
  }

  // ------------------------------------------------------------------ the light
  // Per character of the 40 x 25 screen: LIGHT_RAM its colour RAM, LIGHT_HALF 1 for half-lit.
  const LIGHT_RAM = new Uint8Array(1000), LIGHT_HALF = new Uint8Array(1000);
  const ORDER = [[0, 0.5], [0.75, 0.25]];
  for (let r = 0; r < 25; r++) for (let c = 0; c < 40; c++) {
    const dx = 8 * c + 8 - LIGHT.center.x, dy = 2 * (8 * r + 4 - LIGHT.center.y), d = Math.hypot(dx, dy);
    const step = Math.max(0, Math.min(LIGHT.steps.length - 1, Math.floor((d - LIGHT.full) / LIGHT.step + 1 - ORDER[r & 1][c & 1])));
    [LIGHT_RAM[r * 40 + c], LIGHT_HALF[r * 40 + c]] = LIGHT.steps[step];
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
  // The dungeon around the hero h, lit, through put(x, y, rgb); returns the scroll.
  function background(M, h, put) {
    const P = prepare(M), sc = scroll(h);
    for (let r = 0; r < 25; r++) for (let c = 0; c < 39; c++) {
      const g = P.chars[P.codeAt(sc.cX + c, sc.cY + r) | (LIGHT_HALF[r * 40 + c] << 7)];
      const cols = [COLORS.bg, COLORS.mc1, COLORS.mc2, LIGHT_RAM[r * 40 + c]];
      for (let y = 0; y < 8; y++) {
        const Y = 8 * r + y + sc.ys - 3;
        if (Y < 0 || Y >= 200) continue;
        for (let x = 0; x < 8; x++) {
          const X = 8 * c + x + sc.xs;
          if (X < 320) put(X, Y, PAL[cols[(g[y] >> (6 - 2 * (x >> 1))) & 3]]);
        }
      }
    }
    return sc;
  }
  // What the screen shows: { pixels (320x200 RGBA, the border drawn), scroll }.
  function frame(M, h) {
    const out = new Uint8ClampedArray(320 * 200 * 4);
    const put = (x, y, c) => { const i = (y * 320 + x) * 4; out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2]; out[i + 3] = 255; };
    const sc = background(M, h, put);
    // the hero: feet at HERO, centred across
    const f = FRAMES[spriteFrame(h)], scols = [null, SPRITE.mc1, SPRITE.color, SPRITE.mc2];
    for (let r = 0; r < 21; r++) for (let c = 0; c < 12; c++) {
      const v = f[r][h.facing < 0 ? 11 - c : c];
      if (v) for (const dx of [0, 1]) put(HERO.x - 12 + 2 * c + dx, HERO.y - 20 + r, PAL[scols[v]]);
    }
    for (let y = 0; y < 200; y++) for (let x = 0; x < 320; x++) if (x < 7 || x >= 311 || y < 4 || y >= 196) put(x, y, PAL[COLORS.border]);
    return { pixels: out, scroll: sc };
  }

  return { WALL_H, COLS, ROWS, HERO, COLORS, LIGHT, LIGHT_RAM, LIGHT_HALF, REL, PATTERNS, lookAt,
    phaseOf, anchorOf, patternOf, surface, prepare, scroll, SPRITE, FRAMES, spriteFrame, PAL, background, frame };
});
