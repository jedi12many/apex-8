/*
 * The C64 platformer view: what the screen shows each frame, exactly as the engine is to show it.
 *
 * Multicolor characters, 38 columns, 50 frames a second. The screen is three bands, each with its own
 * hardware fine scroll and colours (set by raster splits), plus a layer drawn in characters:
 *   rows 0-4    far mountains, 1/4 of the camera's speed
 *   rows 5-8    hills, 1/2
 *   rows 9-24   the level, full speed: APEXSCII side-oblique blocks (forest theme) whose tops and sides
 *               recede up-right; its empty cells show a forest backdrop that moves at 3/4, made by
 *               redrawing a few characters each frame (in 2-pixel steps, as multicolor pixels are 2 wide)
 * The player is a multicolor hardware sprite, and up to 7 of the level's objects (coins, beetles, the
 * flag) on sprites 1-7 (objectSprites). Colour RAM never changes: each band has one value.
 *
 * Works in Node and in the browser (global APEXSIDE, needing APEXSCII and APEXPLAT).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../../apexscii/apexscii.js'), require('../../core/platform.js'));
  else root.APEXSIDE = factory(root.APEXSCII, root.APEXPLAT);
})(typeof self !== 'undefined' ? self : this, function (APEXSCII, PLAT) {
  'use strict';

  const ROWS = { far: [0, 5], hills: [5, 9], level: [9, 25] };
  const SPEED = { far: [1, 4], hills: [1, 2], back: [3, 4] }; // numerator, denominator of the camera's
  const TOP = ROWS.level[0] * 8; // the level's first pixel line
  // Colours per band: background ($D021), MC1 ($D022), MC2 ($D023), colour RAM (0-7; + 8 for multicolor).
  const PALETTE = {
    far: { bg: 14, mc1: 12, mc2: 1, ram: 6 },   // sky; lit rock, snow, rock in shadow
    hills: { bg: 14, mc1: 13, mc2: 5, ram: 5 }, // sky; lit grass, grass, grass in shadow
    level: { bg: 14, mc1: 9, mc2: 11, ram: 5 }, // sky; earth fronts, earth sides and the forest behind, grass tops
  };
  // The level band's background is the hills' green behind the treetops, then sky from LEVEL_SKY (a
  // line the solid canopy hides, and not a bad line, so a raster split can change it there).
  const LEVEL_TOP_BG = 5, LEVEL_SKY = ROWS.level[0] * 8 + 12;
  const BORDER = 0;
  const SPRITE = { mc1: 0, mc2: 10, color: 2 }; // $D025 outline, $D026 skin, the player's own colour

  // ------------------------------------------------------------------ characters
  const base = APEXSCII.buildDefault('mc', 'side', 'forest');
  const chars = base.glyphs.map(g => Uint8Array.from(g));
  const FREE = [];
  for (const r of base.regions) if (r.name === 'free') for (let c = r.from; c <= r.to; c++) FREE.push(c);
  for (let c = 1; c < 0x40; c++) FREE.push(c); // the text: the status line will use the ROM font
  let nextFree = 0;
  const glyphCodes = new Map();
  // A code for an 8-byte glyph, sharing any that are the same.
  function glyph(bytes) {
    const key = bytes.join(',');
    if (glyphCodes.has(key)) return glyphCodes.get(key);
    if (nextFree >= FREE.length) throw new Error('out of characters');
    const code = FREE[nextFree++];
    chars[code] = Uint8Array.from(bytes);
    glyphCodes.set(key, code);
    return code;
  }
  glyph([0, 0, 0, 0, 0, 0, 0, 0]); // code $6B... blank stays first so the empty glyph is shared
  const BLANK = glyphCodes.get('0,0,0,0,0,0,0,0');
  // A glyph from 8 rows of 4 two-bit pixels.
  const pack = rows => rows.map(r => (r[0] << 6) | (r[1] << 4) | (r[2] << 2) | r[3]);

  // The forest set's side-oblique glyphs by face pair: E empty, T top, F front, R side.
  const FACE_WORD = { E: 'empty', T: 'top', F: 'front', R: 'side' };
  const faceCode = {};
  base.names.forEach((n, code) => {
    if (code < 0x40 || code > 0x4e) return; // the first shade set: forest-grass
    const full = n.match(/· (top|front|side) face$/), pair = n.match(/· \/ 45° · (\w+) over (\w+)$/);
    const letter = w => Object.keys(FACE_WORD).find(k => FACE_WORD[k] === w);
    if (full) faceCode[letter(full[1]).repeat(2)] = code;
    if (pair) faceCode[letter(pair[1]) + letter(pair[2])] = code;
  });

  // ------------------------------------------------------------------ the level's characters
  // Which face of the block world is at level pixel (x, y): a block's front, else the nearest top or
  // side face of a block whose box (front pushed back up-right by 8 pixels) covers it, else empty.
  function face(L, x, y) {
    const solid = (bx, by) => bx >= 0 && bx < L.w && by >= 0 && by < L.h && L.solid[by * L.w + bx];
    const bx = Math.floor(x / 16), by = Math.floor(y / 16);
    if (solid(bx, by)) return 'F';
    let best = 'E', bt = 2;
    for (let cy = by; cy <= by + 1; cy++) for (let cx = bx - 1; cx <= bx; cx++) {
      if (!solid(cx, cy)) continue;
      const tt = (16 * cy - y) / 8;
      if (tt >= 0 && tt <= 1 && x - 8 * tt >= 16 * cx && x - 8 * tt < 16 * cx + 16 && tt < bt) { best = 'T'; bt = tt; }
      const ts = (x - 16 * cx - 16) / 8;
      if (ts >= 0 && ts <= 1 && y + 8 * ts >= 16 * cy && y + 8 * ts < 16 * cy + 16 && ts < bt) { best = 'R'; bt = ts; }
    }
    return best;
  }
  // The level as characters (2 per block across, 2 down): each cell's upper-left and lower-right
  // halves of the / diagonal pick an APEXSCII glyph; fully empty cells are EMPTY (the backdrop).
  const EMPTY = -1;
  function compose(L) {
    const w = 2 * L.w, h = 2 * L.h, map = new Int16Array(w * h);
    for (let cy = 0; cy < h; cy++) for (let cx = 0; cx < w; cx++) {
      const a = face(L, 8 * cx + 2, 8 * cy + 2), b = face(L, 8 * cx + 6, 8 * cy + 6);
      map[cy * w + cx] = a === 'E' && b === 'E' ? EMPTY : faceCode[a + b];
      if (map[cy * w + cx] === undefined) throw new Error(`no glyph for ${a} over ${b}`);
    }
    return { w, h, map };
  }

  // ------------------------------------------------------------------ backdrop: a forest at 3/4 speed
  // A 32-pixel (16 fat pixel) pattern down the level band: a canopy with a bumpy top over two trunks.
  // The empty cells in a level row use four characters (by column, mod 4) whose contents are the
  // pattern shifted to the backdrop's position each frame. Rows with the same pattern share them.
  const BACK_W = 16; // fat pixels
  const FOREST = Array.from({ length: 128 }, (_, y) => Array.from({ length: BACK_W }, (_, x) => {
    const top = 3 + Math.round(2 * Math.cos((x * Math.PI) / 4) + Math.cos((x * Math.PI) / 8 + 1));
    const bottom = 22 + ((x * 5) % 4);
    if (y >= top && y < bottom) return 2;
    if (y >= bottom - 2 && (x === 5 || x === 6 || x === 13)) return 2; // trunks
    return 0;
  }));
  const backRows = [], backKinds = [];
  for (let r = 0; r < 16; r++) {
    const rows = FOREST.slice(8 * r, 8 * r + 8), key = rows.join('|');
    let k = backKinds.findIndex(b => b.key === key);
    if (k < 0) {
      k = backKinds.length;
      backKinds.push({ key, rows, codes: [0, 1, 2, 3].map(q => glyph([q, 2, 3, 4, 5, 6, 7, 128 + k])) });
    }
    backRows.push(k);
  }
  // The backdrop's four characters for a row kind, with the pattern shifted s fat pixels.
  function backGlyphs(kind, s) {
    const rows = backKinds[kind].rows;
    return [0, 1, 2, 3].map(q => pack(rows.map(r => [0, 1, 2, 3].map(i => r[(4 * q + i + s) % BACK_W]))));
  }

  // ------------------------------------------------------------------ bands: mountains and hills
  // Heights (pixels up from the band's bottom) at each fat pixel across a repeating band; the side
  // facing left (rising) is lit, the other in shadow. Mountains rise at 45 degrees, hills at half that.
  function band(widthChars, rowsHigh, peaks, slope, snow, ground) {
    const fat = widthChars * 4, H = rowsHigh * 8, px = [];
    for (let y = 0; y < H; y++) px.push(new Array(fat).fill(0));
    for (let f = 0; f < fat; f++) {
      const x = 2 * f + 1;
      let h = ground, lit = true;
      for (const [cx, ch] of peaks) for (const wrap of [-2 * fat, 0, 2 * fat]) {
        const v = ch - Math.abs(x - cx - wrap) * slope;
        if (v > h) { h = v; lit = x < cx + wrap; }
      }
      for (let y = 0; y < H; y++) if (H - y <= h) px[y][f] = snow && H - y > snow ? 2 : H - y <= ground ? 3 : lit ? 1 : 3;
    }
    const map = [];
    for (let cy = 0; cy < rowsHigh; cy++) for (let cx = 0; cx < widthChars; cx++)
      map.push(glyph(pack(px.slice(8 * cy, 8 * cy + 8).map(r => r.slice(4 * cx, 4 * cx + 4)))));
    return { w: widthChars, h: rowsHigh, map };
  }
  const FAR = band(64, 5, [[40, 30], [120, 38], [168, 26], [250, 34], [330, 40], [410, 28], [470, 32]], 1, 30, 6);
  const HILLS = band(48, 4, [[30, 22], [110, 30], [190, 20], [260, 28], [340, 24]], 0.5, 0, 12);

  // ------------------------------------------------------------------ the player's sprite
  // 12 fat pixels by 21 rows: k outline ($D025), x skin ($D026), o the sprite's colour.
  const BODY = [
    '....kkkk....', '...kkkkkk...', '...kxxxxk...', '...xkxxkx...', '...xxxxxx...', '....xxxx....',
    '...oooooo...', '..oooooooo..', '..xoooooox..', '..xoooooox..', '..x.oooo.x..', '....oooo....',
    '....kkkk....',
  ];
  const LEGS = {
    stand: ['....o..o....', '....o..o....', '....o..o....', '....o..o....', '....o..o....', '...kk..kk...', '............', '............'],
    run1: ['....o..o....', '...o....o...', '..o......o..', '..o......o..', '.kk......kk.', '............', '............', '............'],
    run2: ['....oo......', '....oo......', '.....o......', '.....o......', '....kk......', '............', '............', '............'],
    jump: ['...o....o...', '..o......o..', '..kk....kk..', '............', '............', '............', '............', '............'],
  };
  const FRAMES = {};
  for (const [name, legs] of Object.entries(LEGS)) {
    const rows = [...BODY, ...legs].map(r => Array.from(r, c => ({ k: 1, o: 2, x: 3 }[c] || 0)));
    // the feet on the bottom row, so they sit on the ground
    while (rows[rows.length - 1].every(v => !v)) rows.pop();
    while (rows.length < 21) rows.unshift(new Array(12).fill(0));
    FRAMES[name] = rows.slice(-21);
  }
  // The objects' sprites: the same shared colours; their own colour as SPRITE_COLOR says. Images sit
  // at the bottom of the sprite.
  const OBJ_ART = {
    coin0: ['....kkkk....', '...kooook...', '...koxook...', '...koxook...', '...koxook...', '...koxook...', '...koxook...', '...koxook...', '...kooook...', '....kkkk....'],
    coin1: ['....kkkk....', '....koxk....', '....koxk....', '....koxk....', '....koxk....', '....koxk....', '....koxk....', '....koxk....', '....kook....', '....kkkk....'],
    coin2: ['.....kk.....', '.....kk.....', '.....kk.....', '.....kk.....', '.....kk.....', '.....kk.....', '.....kk.....', '.....kk.....', '.....kk.....', '.....kk.....'],
    beetle0: ['...kkkkkk...', '..kooooook..', '.kooxoooook.', '.kooooooook.', 'kxxkoooooxxk', 'kkkkkkkkkkkk', '.k.k....k.k.', 'k...k..k...k'],
    beetle1: ['...kkkkkk...', '..kooooook..', '.kooxoooook.', '.kooooooook.', 'kxxkoooooxxk', 'kkkkkkkkkkkk', '..k.k..k.k..', '..k.k..k.k..'],
    squashed: ['.kkkkkkkkkk.', 'kooooooooook', 'kkkkkkkkkkkk'],
    flag0: ['..koooooo...', '..koooooooo.', '..kooxxoooo.', '..koooooooo.', '..koooooo...', '..k.........', '..k.........', '..k.........',
      '..k.........', '..k.........', '..k.........', '..k.........', '..k.........', '..k.........', '..k.........', '..k.........',
      '..k.........', '..k.........', '..k.........', '..k.........', '.kkk........'],
    flag1: ['..kooooo....', '..koooooooo.', '..kooxxooooo', '..koooooooo.', '..kooooo....', '..k.........', '..k.........', '..k.........',
      '..k.........', '..k.........', '..k.........', '..k.........', '..k.........', '..k.........', '..k.........', '..k.........',
      '..k.........', '..k.........', '..k.........', '..k.........', '.kkk........'],
  };
  OBJ_ART.coin3 = OBJ_ART.coin1;
  // (a coin's image is at the top of its sprite, so its sprite starts at the coin; the others stand at
  // its bottom)
  for (const [name, rows] of Object.entries(OBJ_ART)) {
    const out = rows.map(r => Array.from(r.padEnd(12, '.'), c => ({ k: 1, o: 2, x: 3 }[c] || 0)));
    while (out.length < 21) name.startsWith('coin') ? out.push(new Array(12).fill(0)) : out.unshift(new Array(12).fill(0));
    FRAMES[name] = out;
  }
  const OBJ_COLOR = { [PLAT.COIN]: 7, [PLAT.BEETLE]: 4, [PLAT.FLAG]: 1 };
  // An object's sprite's top line: a coin's at the coin; the others' 21 lines up from their feet. No
  // object's sprite may cross a raster split (the level's top, or where its sky starts): sprites on a
  // split's line would take the cycles that place it. The C64 generator checks.
  const objectY = o => (o.kind === PLAT.COIN ? TOP + (o.y >> 4) : TOP + ((o.y + o.h) >> 4) - 21);
  // An object's image this frame (t: the game's tick).
  function objectFrame(o, t) {
    if (o.kind === PLAT.COIN) return 'coin' + ((t >> 3) & 3);
    if (o.kind === PLAT.FLAG) return 'flag' + ((t >> 4) & 1);
    return o.dying ? 'squashed' : 'beetle' + ((t >> 3) & 1);
  }
  // The objects shown as sprites, at most 7 (hardware sprites 1-7; the player is 0): of those on and on
  // the screen, the nearest the player across (by their middles); at the same distance the beetles
  // first, then the coins and the flag, each in order. The nearest gets sprite 1, and lower sprites are
  // in front. [{ x, y (the sprite's top left), frame, color }]
  function objectSprites(g, cam) {
    const px = (g.p.x + PLAT.PHYS.width / 2) >> 4;
    return [...g.beetles, ...g.items].map((o, i) => [o, i]).filter(([o]) => o.on && (o.x >> 4) - cam + 24 > 0 && (o.x >> 4) - cam - 24 < 320)
      .map(([o, i]) => [o, i, Math.abs(((o.x + o.w / 2) >> 4) - px)]).sort((a, b) => a[2] - b[2] || a[1] - b[1]).slice(0, 7)
      .map(([o]) => ({ x: ((o.x + o.w / 2) >> 4) - cam - 12, y: objectY(o), frame: objectFrame(o, g.t), color: OBJ_COLOR[o.kind] }));
  }
  function spriteFrame(p) {
    if (!p.ground) return 'jump';
    if (!p.vx) return 'stand';
    return (p.frame >> 2) & 1 ? 'run2' : 'run1';
  }

  // ------------------------------------------------------------------ a frame
  const PAL = APEXSCII.PALETTE.map(h => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16)));
  // The level band's backdrop shift: the forest moves at 3/4 while the level moves at full speed, so
  // its pattern slides (cam - cam * 3/4) pixels, in whole fat pixels.
  const backShift = cam => ((cam - Math.floor((cam * SPEED.back[0]) / SPEED.back[1])) >> 1) % BACK_W;

  // What the screen shows: { pixels (320x200 RGBA, the 38-column border drawn), and the state the
  // engine has: band offsets, backdrop shift }.
  function frame(level, map, p, cam, objs = []) {
    const out = new Uint8ClampedArray(320 * 200 * 4);
    const put = (x, y, c) => { const i = (y * 320 + x) * 4; out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2]; out[i + 3] = 255; };
    const decode = (g, x, y) => (g[y] >> (6 - 2 * (x >> 1))) & 3;
    const drawBand = (rows, src, offset, pal) => {
      const cols = [pal.bg, pal.mc1, pal.mc2, pal.ram];
      for (let y = rows[0] * 8; y < rows[1] * 8; y++) for (let X = 0; X < 320; X++) {
        const bx = offset + X, cx = Math.floor(bx / 8) % src.w, cy = (y >> 3) - rows[0];
        put(X, y, PAL[cols[decode(chars[src.map[cy * src.w + cx]], bx & 7, y & 7)]]);
      }
    };
    // (rounded up, so every band's first column changes as the level's does: at a camera of 8k + 1,
    // which lets the C64 engine draw a band before it's needed)
    drawBand(ROWS.far, FAR, Math.ceil((cam * SPEED.far[0]) / SPEED.far[1]), PALETTE.far);
    drawBand(ROWS.hills, HILLS, Math.ceil((cam * SPEED.hills[0]) / SPEED.hills[1]), PALETTE.hills);
    // the level: its empty cells take the backdrop characters as shifted this frame
    const s = backShift(cam), back = backKinds.map((_, k) => backGlyphs(k, s));
    const pal = PALETTE.level;
    for (let y = TOP; y < 200; y++) for (let X = 0; X < 320; X++) {
      const cols = [y < LEVEL_SKY ? LEVEL_TOP_BG : pal.bg, pal.mc1, pal.mc2, pal.ram];
      const lx = cam + X, cx = lx >> 3, cy = (y - TOP) >> 3;
      const code = cx < map.w ? map.map[cy * map.w + cx] : EMPTY;
      const g = code === EMPTY ? back[backRows[cy]][cx & 3] : chars[code];
      put(X, y, PAL[cols[decode(g, lx & 7, (y - TOP) & 7)]]);
    }
    // the objects (sprite 7 drawn first: lower sprites are in front), then the player: feet on the
    // bottom of the box, centred across it
    const scols = [null, SPRITE.mc1, SPRITE.color, SPRITE.mc2];
    for (const o of [...objs].reverse()) {
      const g = FRAMES[o.frame], cols = [null, SPRITE.mc1, o.color, SPRITE.mc2];
      for (let r = 0; r < 21; r++) for (let c = 0; c < 12; c++) {
        const v = g[r][c];
        if (v) for (const dx of [0, 1]) { const X = o.x + 2 * c + dx, Y = o.y + r; if (X >= 0 && X < 320 && Y >= 0 && Y < 200) put(X, Y, PAL[cols[v]]); }
      }
    }
    if (p.hidden) { for (let y = 0; y < 200; y++) for (let X = 0; X < 320; X++) if (X < 7 || X >= 311) put(X, y, PAL[BORDER]); return { pixels: out, shift: s }; }
    const f = FRAMES[spriteFrame(p)], sx = (p.x >> 4) - cam - 6, sy = TOP + (p.y >> 4) + 20 - 21;
    for (let r = 0; r < 21; r++) for (let c = 0; c < 12; c++) {
      const v = f[r][p.facing < 0 ? 11 - c : c];
      if (!v) continue;
      for (const dx of [0, 1]) {
        const X = sx + 2 * c + dx, Y = sy + r;
        if (X >= 0 && X < 320 && Y >= 0 && Y < 200) put(X, Y, PAL[scols[v]]);
      }
    }
    for (let y = 0; y < 200; y++) for (let X = 0; X < 320; X++) if (X < 7 || X >= 311) put(X, y, PAL[BORDER]);
    return { pixels: out, shift: s };
  }

  return { ROWS, SPEED, PALETTE, LEVEL_TOP_BG, LEVEL_SKY, SPRITE, BORDER, TOP, BACK_W, chars, FREE, glyphsUsed: () => nextFree, compose, frame, FRAMES, FAR, HILLS, backRows, backKinds, backGlyphs, backShift, EMPTY, spriteFrame, OBJ_COLOR, objectY, objectFrame, objectSprites };
});
