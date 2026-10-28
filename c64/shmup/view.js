/*
 * The C64 shoot-'em-up view: what the screen shows each frame, exactly as the engine is to show it.
 *
 * Multicolor characters, 40 columns by 24 rows, scrolled down a line a frame by the VIC's vertical fine
 * scroll. The level's tiles are 2x2 characters, drawn from each tile and its four neighbours: hull
 * plates with lit and shaded rims, seams, vents, lamps and turret bases, the hull's front face hanging
 * below it over space, and a starfield. Colour RAM never changes: one value for the whole screen.
 *
 * Everything that moves is a hardware sprite, more of them than the VIC's eight: a multiplexer gives
 * each one a hardware sprite for its stretch of the screen, in order down the screen, so that one
 * hardware sprite shows many objects one below another. multiplex() is the rule, and the engine must
 * follow it exactly:
 *   - objects wholly in the border are left out
 *   - the rest are taken in order of Y (ties in the order of objects()), and the n-th one shown gets
 *     hardware sprite n mod 8
 *   - an object is shown only if it starts at least GAP lines below the last object on that hardware
 *     sprite (time for the VIC to finish that one and for an interrupt to set this one up); otherwise
 *     it is left out this frame and the next object tries the same hardware sprite
 * Where sprites overlap, the lower hardware sprite is in front, as on the VIC.
 *
 * Works in Node and in the browser (global APEXSHMUPVIEW, needing APEXSCII and APEXSHMUP).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../../apexscii/apexscii.js'), require('../../core/shmup.js'));
  else root.APEXSHMUPVIEW = factory(root.APEXSCII, root.APEXSHMUP);
})(typeof self !== 'undefined' ? self : this, function (APEXSCII, G) {
  'use strict';

  // $D020, $D021 space, $D022 shadow and seams, $D023 the hull, colour RAM (multicolor) rims, lamps, stars.
  const COLORS = { border: 0, bg: 0, mc1: 11, mc2: 12, ram: 1 };
  const GAP = 24;

  // ------------------------------------------------------------------ the level's characters
  // Fat pixels: 0 space, 1 dark grey, 2 hull grey, 3 white. A tile is 8 fat pixels by 16 lines.
  const hull = k => k !== G.SPACE;
  function tilePixel(L, tx, ty, X, Y) {
    const at = (dx, dy) => G.tileAt(L, tx + dx, ty + dy), k = at(0, 0);
    if (k === G.SPACE) {
      // the hull's front face, below its edge
      if (hull(at(0, -1)) && Y < 8) return Y === 7 || (X & 3) === 3 ? 0 : 1;
      // a few stars, placed by a hash of the tile
      const h = (tx * 73 + ty * 151 + ((tx * ty) & 15) * 29) & 255;
      if (h % 3) return 0;
      const sx = (h >> 2) & 7, sy = 8 + ((h >> 5) & 7);
      return X === sx && Y === sy ? (h & 1 ? 3 : 1) : 0;
    }
    if (Y === 0 && !hull(at(0, -1))) return 3; // lit rims, top and left
    if (X === 0 && !hull(at(-1, 0))) return 3;
    if (Y === 15 || X === 7) return 1; // shaded rims, and seams between plates
    switch (k) {
      case G.VENT: if (X >= 1 && X <= 6 && Y >= 3 && Y <= 12) return Y & 1 ? 0 : 1; break;
      case G.LAMP:
        if (X >= 3 && X <= 4 && Y >= 6 && Y <= 9) return 3;
        if (X >= 2 && X <= 5 && Y >= 5 && Y <= 10) return 1;
        break;
      case G.BASE: {
        const d = Math.hypot(2 * X + 1 - 8, Y + 0.5 - 8);
        if (d < 4) return 0;
        if (d < 6) return 1;
        break;
      }
      default:
        if ((X === 1 || X === 6) && (Y === 2 || Y === 13)) return 1; // rivets
    }
    return 2;
  }

  // The level's characters, shared where they look the same, and its screen: rows of 40 codes, two per
  // tile row, top to bottom. { chars (256 x 8 bytes), count, rows (Uint8Array, 40 x 2h) }
  const prepared = new WeakMap();
  function prepare(L) {
    if (prepared.has(L)) return prepared.get(L);
    const chars = Array.from({ length: 256 }, () => new Uint8Array(8)), byLook = new Map();
    const rows = new Uint8Array(40 * 2 * L.h);
    for (let ty = 0; ty < L.h; ty++) for (let tx = 0; tx < G.WIDTH; tx++) for (let q = 0; q < 4; q++) {
      const cx = q & 1, cy = q >> 1, bytes = [];
      for (let y = 0; y < 8; y++) {
        let b = 0;
        for (let f = 0; f < 4; f++) b |= tilePixel(L, tx, ty, 4 * cx + f, 8 * cy + y) << (6 - 2 * f);
        bytes.push(b);
      }
      const key = bytes.join(',');
      if (!byLook.has(key)) {
        if (byLook.size >= 256) throw new Error(`${L.name}: more than 256 characters`);
        chars[byLook.size] = Uint8Array.from(bytes);
        byLook.set(key, byLook.size);
      }
      rows[(2 * ty + cy) * 40 + 2 * tx + cx] = byLook.get(key);
    }
    const P = { chars, count: byLook.size, rows };
    prepared.set(L, P);
    return P;
  }

  // ------------------------------------------------------------------ scrolling
  // The VIC shows screen row r from Y = 8r + ys - 3 (ys: the fine scroll), so with the level's line
  // camY at the top of the screen, row 0 is the level's character row cY.
  function scroll(g) {
    const ys = (3 - g.camY) & 7;
    return { ys, cY: (g.camY + ys - 3) >> 3 };
  }

  // ------------------------------------------------------------------ sprites
  // 12 fat pixels across: a the object's own colour, w $D025, d $D026.
  const SPRITE = { mc1: 1, mc2: 11 };
  const art = (...rows) => rows;
  const SHIP = art(
    '.....dd.....', '.....ww.....', '....waaw....', '....adda....', '....adda....', '...aawwaa...', '...aawwaa...',
    '.d.aaaaaa.d.', '.w.aaddaa.w.', '.waaaddaaaw.', 'waaaaaaaaaaw', 'aaaaaaaaaaaa', 'aad.aaaa.daa', 'ad..aaaa..da',
    'a...dwwd...a', '....d..d....');
  const DRONE = ['....dddd....', '...daaaad...', '..daawwaad..', '.dddddddddd.', 'daaaaaaaaaad', null, '.dddddddddd.', '...d....d...', '..d......d..'];
  const ART = {
    ship0: [...SHIP, '....w..w....'],
    ship1: [...SHIP, '....w..w....', '....w..w....'],
    shot: art('..w......w..', '..w......w..', '..a......a..', '..a......a..', '..a......a..', '..a......a..'),
    drone0: DRONE.map(r => r || 'dawaawaawaad'),
    drone1: DRONE.map(r => r || 'daawaawaawad'),
    swooper: art('.d........d.', '.a........a.', '.aa..dd..aa.', '.aaaaaaaaaa.', '..aawaawaa..', '...aaaaaa...',
      '...adwwda...', '....aaaa....', '....adda....', '.....aa.....', '.....ww.....'),
    turret: art('............', '............', '...dddddd...', '..daaaaaad..', '.daawwaaaad.', '.dawwaaaaad.',
      '.daaaaaaaad.', '.daaaddaaad.', '.daaaddaaad.', '..daaaaaad..', '...dddddd...'),
    bullet: art('aaa', 'awa', 'awa', 'aaa'),
  };
  // the explosion: a ring that grows and breaks up over 4 frames
  for (let k = 0; k < 4; k++) {
    const outer = [4, 7, 9, 10][k], inner = [0, 3, 6, 8][k], rows = [];
    for (let r = 0; r < 17; r++) {
      let s = '';
      for (let c = 0; c < 12; c++) {
        const d = Math.hypot(2 * (c - 5.5), r - 8);
        s += d < inner || d >= outer || (c * 3 + r * 5 + k) % 4 === 0 ? '.' : d < (inner + outer) / 2 ? 'w' : 'a';
      }
      rows.push(s);
    }
    ART['boom' + k] = rows;
  }
  // As 21 rows of 12 fat pixels (0 clear, 1 $D025, 2 own colour, 3 $D026), in the engine's order.
  const FRAME_NAMES = Object.keys(ART);
  const FRAMES = {};
  for (const name of FRAME_NAMES) {
    const rows = ART[name].map(r => Array.from(r.padEnd(12, '.'), ch => ({ w: 1, a: 2, d: 3 }[ch] || 0)));
    while (rows.length < 21) rows.push(new Array(12).fill(0));
    FRAMES[name] = rows;
  }
  const COLOR = { ship: 14, shot: 7, [G.DRONE]: 10, [G.SWOOPER]: 5, [G.TURRET]: 2, flash: 1, bullet: 7, boom: 8 };

  // What the game shows as sprites, in order: the ship, its shots, the enemies, their bullets.
  // [{ x, y, frame, color }]
  function objects(g) {
    const out = [], p = g.player;
    if (!p.dead) {
      if (!(p.invuln & 4)) out.push({ x: p.x, y: p.y, frame: (g.t >> 2) & 1 ? 'ship1' : 'ship0', color: COLOR.ship });
    } else if (p.dead > G.DEAD_FOR - 16) out.push({ x: p.x, y: p.y, frame: 'boom' + ((G.DEAD_FOR - p.dead) >> 2), color: COLOR.boom });
    for (const s of g.shots) if (s.on) out.push({ x: s.x, y: s.y, frame: 'shot', color: COLOR.shot });
    for (const e of g.enemies) {
      if (e.kind === G.FREE) continue;
      if (e.kind === G.BOOM) { out.push({ x: e.x, y: e.y, frame: 'boom' + (e.t >> 2), color: COLOR.boom }); continue; }
      const frame = e.kind === G.DRONE ? ((e.t >> 3) & 1 ? 'drone1' : 'drone0') : e.kind === G.SWOOPER ? 'swooper' : 'turret';
      out.push({ x: e.x, y: e.y, frame, color: e.flash ? COLOR.flash : COLOR[e.kind] });
    }
    for (const b of g.bullets) if (b.on) out.push({ x: b.x >> 4, y: b.y >> 4, frame: 'bullet', color: COLOR.bullet });
    return out;
  }

  // The multiplexer's rule (see the top): the objects shown, each with its hardware sprite.
  function multiplex(objs) {
    const shown = [], last = new Array(8).fill(-1000);
    const order = objs.map((o, i) => [o, i]).filter(([o]) => o.y > -17 && o.y < 196 && o.x > -24 && o.x < 320)
      .sort((a, b) => a[0].y - b[0].y || a[1] - b[1]);
    for (const [o] of order) {
      const slot = shown.length & 7;
      if (o.y - last[slot] < GAP) continue;
      last[slot] = o.y;
      shown.push(Object.assign({ slot }, o));
    }
    return shown;
  }

  // ------------------------------------------------------------------ a frame
  const PAL = APEXSCII.PALETTE.map(hx => [1, 3, 5].map(i => parseInt(hx.substr(i, 2), 16)));
  // What the screen shows: { pixels (320x200 RGBA, the border drawn), scroll, sprites (multiplex()) }.
  function frame(L, g) {
    const P = prepare(L), out = new Uint8ClampedArray(320 * 200 * 4);
    const put = (x, y, c) => { const i = (y * 320 + x) * 4; out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2]; out[i + 3] = 255; };
    const sc = scroll(g), rowsN = 2 * L.h, cols = [COLORS.bg, COLORS.mc1, COLORS.mc2, COLORS.ram];
    for (let r = 0; r < 25; r++) {
      const row = (((sc.cY + r) % rowsN) + rowsN) % rowsN;
      for (let c = 0; c < 40; c++) {
        const ch = P.chars[P.rows[row * 40 + c]];
        for (let y = 0; y < 8; y++) {
          const Y = 8 * r + y + sc.ys - 3;
          if (Y < 0 || Y >= 200) continue;
          for (let x = 0; x < 8; x++) put(8 * c + x, Y, PAL[cols[(ch[y] >> (6 - 2 * (x >> 1))) & 3]]);
        }
      }
    }
    // sprites, the highest hardware sprite first so the lowest ends up in front
    const sprites = multiplex(objects(g));
    for (const s of [...sprites].sort((a, b) => b.slot - a.slot)) {
      const f = FRAMES[s.frame], scols = [null, SPRITE.mc1, s.color, SPRITE.mc2];
      for (let r = 0; r < 21; r++) for (let c = 0; c < 12; c++) {
        const v = f[r][c];
        if (!v) continue;
        for (const dx of [0, 1]) {
          const X = s.x + 2 * c + dx, Y = s.y + r;
          if (X >= 0 && X < 320 && Y >= 0 && Y < 200) put(X, Y, PAL[scols[v]]);
        }
      }
    }
    for (let y = 0; y < 200; y++) if (y < 4 || y >= 196) for (let x = 0; x < 320; x++) put(x, y, PAL[COLORS.border]);
    return { pixels: out, scroll: sc, sprites };
  }

  return { COLORS, GAP, SPRITE, FRAME_NAMES, FRAMES, COLOR, tilePixel, prepare, scroll, objects, multiplex, frame };
});
