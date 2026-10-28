// Generates the C64 dungeon's data and code from the reference (core/iso.js, c64/iso/view.js), so the
// 6502 engine moves the hero and draws the screen exactly as the reference does:
//   gen.inc      constants (ca65 source)
//   copy.inc     the screen shifts: for each direction and screen, the other screen copied one
//                character over, unrolled down the 25 rows
//   fix.inc      the light fixups: after a shift, the characters whose half-lit bit must change
//   col.inc      a new column of the screen, unrolled down the 25 rows
//   charset.bin  the map's characters (0-127, and 128-255 half-lit)
//   sprites.bin  the hero, 6 frames (stand, walk, walk; then mirrored)
//   cmap.bin     the code maps: for each anchor row, 256 bytes: phase * 64 + anchor column -> character
//   looks.bin    the map's tiles (looks), rows of 64
//   light.bin    per screen character: colour RAM (1000 bytes), then the half-lit bit as $80 (1000)
//
// gen(map, dir) writes the files; build.js assembles them.
const fs = require('fs'), path = require('path');
const ISO = require('../../core/iso.js');
const VIEW = require('./view.js');

// The fixup lists' directions, each with a positive offset D = 40 dy + dx, so its list also serves the
// opposite direction from X = D.
const DIRS = [[1, 0], [0, 1], [1, 1], [-1, 1]];

function gen(M, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  if (M.w > 64 || M.h > 64) throw new Error('map too big for the C64 engine (64 x 64 tiles at most)');
  for (let i = 0; i < M.w; i++) for (const [x, y] of [[i, 0], [i, M.h - 1], [0, i], [M.w - 1, i]])
    if (x < M.w && y < M.h && ISO.tileAt(M, x, y) === ISO.FLOOR) throw new Error('floor on the map edge');
  const P = VIEW.prepare(M);

  // ---------------------------------------------------------------- anchors the screen can need
  // For every place the hero can stand, the screen's corner characters' anchors; the code maps cover
  // them all, offset by OFF so they start at 0.
  let ax0 = Infinity, ax1 = -Infinity, ay0 = Infinity, ay1 = -Infinity, cx0 = Infinity, cx1 = -Infinity, cy0 = Infinity, cy1 = -Infinity;
  for (let ty = 0; ty < M.h; ty++) for (let tx = 0; tx < M.w; tx++) {
    if (ISO.tileAt(M, tx, ty) !== ISO.FLOOR) continue;
    for (const hx of [tx * 256, tx * 256 + 255]) for (const hy of [ty * 256, ty * 256 + 255]) {
      const s = VIEW.scroll({ x: hx, y: hy });
      cx0 = Math.min(cx0, s.cX); cx1 = Math.max(cx1, s.cX); cy0 = Math.min(cy0, s.cY); cy1 = Math.max(cy1, s.cY);
      for (const [c, r] of [[0, 0], [38, 0], [0, 24], [38, 24]]) {
        const [ax, ay] = VIEW.anchorOf(s.cX + c, s.cY + r);
        ax0 = Math.min(ax0, ax); ax1 = Math.max(ax1, ax); ay0 = Math.min(ay0, ay); ay1 = Math.max(ay1, ay);
      }
    }
  }
  if (ax1 - ax0 >= 64 || ay1 - ay0 >= 64) throw new Error(`the screen's anchors span ${ax1 - ax0 + 1} x ${ay1 - ay0 + 1}: at most 64 x 64`);
  if (cx0 <= -128 || cx1 > 127 || cy0 <= -128 || cy1 > 127) throw new Error('the camera leaves signed 8-bit character coordinates (-127 to 127)');
  const OFFX = -ax0, OFFY = -ay0;

  // ---------------------------------------------------------------- data files
  fs.writeFileSync(path.join(outDir, 'charset.bin'), Buffer.concat(P.chars.map(g => Buffer.from(g))));

  const order = ['stand', 'walk1', 'walk2'], sprites = Buffer.alloc(6 * 64);
  order.forEach((name, f) => [false, true].forEach((mirror, m) => {
    const rows = VIEW.FRAMES[name];
    for (let r = 0; r < 21; r++) for (let b = 0; b < 3; b++) {
      let v = 0;
      for (let i = 0; i < 4; i++) v = (v << 2) | rows[r][mirror ? 11 - (4 * b + i) : 4 * b + i];
      sprites[(f + 3 * m) * 64 + r * 3 + b] = v;
    }
  }));
  fs.writeFileSync(path.join(outDir, 'sprites.bin'), sprites);

  // code maps: row ay + OFFY, byte phase * 64 + ax + OFFX
  const cmap = Buffer.alloc(64 * 256);
  for (let ay = ay0; ay <= ay1; ay++) for (let ax = ax0; ax <= ax1; ax++) for (let p = 0; p < 4; p++) {
    const r = VIEW.REL[p], lk = i => VIEW.lookAt(M, ax + r[i][0], ay + r[i][1]), wall = l => (l >= 3 ? l - 2 : 0);
    const n = lk(0) + 5 * lk(1) + 25 * wall(lk(2)) + 75 * wall(lk(3)), code = P.codes[p * VIEW.PATTERNS + n];
    if (code < 0) throw new Error(`no character for phase ${p} at anchor ${ax},${ay}`);
    cmap[(ay + OFFY) * 256 + p * 64 + ax + OFFX] = code;
  }
  fs.writeFileSync(path.join(outDir, 'cmap.bin'), cmap);

  const looks = Buffer.alloc(64 * M.h);
  for (let ty = 0; ty < M.h; ty++) for (let tx = 0; tx < M.w; tx++) looks[ty * 64 + tx] = VIEW.lookAt(M, tx, ty);
  fs.writeFileSync(path.join(outDir, 'looks.bin'), looks);

  const light = Buffer.alloc(2000);
  for (let i = 0; i < 1000; i++) { light[i] = VIEW.LIGHT_RAM[i] + 8; light[1000 + i] = VIEW.LIGHT_HALF[i] << 7; }
  fs.writeFileSync(path.join(outDir, 'light.bin'), light);

  // ---------------------------------------------------------------- code
  // copy_<dx>_<dy>_<to>: screen <to> = the other screen shifted, so character (r, c) comes from
  // (r + dy, c + dx). Rows whose source is off the screen are left for the edge routines.
  const name = v => (v < 0 ? 'm' : v > 0 ? 'p' : 'z');
  const copy = [];
  for (const dy of [-1, 0, 1]) for (const dx of [-1, 0, 1]) {
    if (!dx && !dy) continue;
    for (const to of ['a', 'b']) {
      const from = to === 'a' ? 'SCREEN_B' : 'SCREEN_A', label = `copy_${name(dx)}${name(dy)}_${to}`;
      copy.push(`${label}:`, '    ldx #38', `${label}_loop:`);
      for (let r = 0; r < 25; r++) {
        if (r + dy < 0 || r + dy > 24) continue;
        copy.push(`    lda ${from}+${(r + dy) * 40 + dx},x`, `    sta SCREEN_${to.toUpperCase()}+${r * 40},x`);
      }
      copy.push('    dex', `    bmi ${label}_done`, `    jmp ${label}_loop`, `${label}_done:`, '    rts', '');
    }
  }
  // the table of copies by (dy + 1) * 3 + dx + 1, per screen
  for (const to of ['a', 'b']) {
    const labels = [];
    for (const dy of [-1, 0, 1]) for (const dx of [-1, 0, 1]) labels.push(dx || dy ? `copy_${name(dx)}${name(dy)}_${to}` : 'copy_none');
    copy.push(`COPY_${to.toUpperCase()}_LO: .lobytes ${labels.join(', ')}`, `COPY_${to.toUpperCase()}_HI: .hibytes ${labels.join(', ')}`);
  }
  copy.push('copy_none:', '    rts', '');
  fs.writeFileSync(path.join(outDir, 'copy.inc'), copy.join('\n') + '\n');

  // fix_<k>_<screen>: flip bit 7 of each character where the light's half-lit bit differs between it
  // and its source, X = 0 for direction k, or X = its D for the opposite (whose list is this one moved
  // by D, each pair the other way round). Dark characters look the same either way, so a pair is
  // skipped when both are dark.
  const fix = [], fixCounts = {};
  DIRS.forEach(([dx, dy], k) => {
    const D = 40 * dy + dx, list = [];
    for (let r = 0; r < 25; r++) for (let c = 0; c < 39; c++) {
      const r2 = r + dy, c2 = c + dx;
      if (r2 < 0 || r2 > 24 || c2 < 0 || c2 > 38) continue;
      const o = r * 40 + c, s = r2 * 40 + c2;
      if (VIEW.LIGHT_HALF[o] !== VIEW.LIGHT_HALF[s] && (VIEW.LIGHT_RAM[o] || VIEW.LIGHT_RAM[s])) list.push(o);
    }
    fixCounts[`${dx},${dy}`] = list.length;
    for (const scr of ['A', 'B']) {
      fix.push(`fix_${k}_${scr.toLowerCase()}:`);
      for (const o of list) fix.push(`    lda SCREEN_${scr}+${o},x`, '    eor #$80', `    sta SCREEN_${scr}+${o},x`);
      fix.push('    rts', '');
    }
  });
  fs.writeFileSync(path.join(outDir, 'fix.inc'), fix.join('\n') + '\n');

  // col_<screen>_<even|odd>: column X of the screen, from the state line() left (ax, cptr) and the two
  // phases' code map columns pa (even rows) and pb (odd rows). Down a column the anchor moves on (ax
  // and the code map row both + 1) after each character of phase 1 or 2: after the even rows or the
  // odd ones.
  const col = [];
  for (const scr of ['A', 'B']) for (const parity of [0, 1]) {
    col.push(`col_${scr.toLowerCase()}_${parity ? 'odd' : 'even'}:`);
    for (let r = 0; r < 25; r++) {
      col.push('    lda ax', `    ora ${r & 1 ? 'pb' : 'pa'}`, '    tay', '    lda (cptr),y', `    ora HALF+${r * 40},x`, `    sta SCREEN_${scr}+${r * 40},x`);
      if ((r & 1) === parity && r < 24) col.push('    inc ax', '    inc cptr+1');
    }
    col.push('    rts', '');
  }
  fs.writeFileSync(path.join(outDir, 'col.inc'), col.join('\n') + '\n');

  // ---------------------------------------------------------------- constants
  const H = VIEW.HERO;
  const C = {
    MAP_W: M.w, MAP_H: M.h, START_X: M.start.x * ISO.TILE + ISO.TILE / 2, START_Y: M.start.y * ISO.TILE + ISO.TILE / 2,
    RADIUS: ISO.RADIUS, OFFX, OFFY, HERO_X: H.x, HERO_Y: H.y,
    // the sprite: x = HERO.x - 12 + 24; y register one line above its first line
    SPR_X: H.x - 12 + 24, SPR_Y: 51 + H.y - 20 - 1,
    COL_BORDER: VIEW.COLORS.border, COL_BG: VIEW.COLORS.bg, COL_MC1: VIEW.COLORS.mc1, COL_MC2: VIEW.COLORS.mc2,
    SPR_MC1: VIEW.SPRITE.mc1, SPR_MC2: VIEW.SPRITE.mc2, SPR_COLOR: VIEW.SPRITE.color,
  };
  const inc = Object.entries(C).map(([k, v]) => `${k} = ${v}`);
  // movement per joystick bits (0 where the bits are no direction), and which way the hero faces
  const dx = [], dy = [], face = [];
  for (let b = 0; b < 16; b++) {
    const d = ISO.DIRS[b] || [0, 0], s = d[0] - d[1];
    dx.push(d[0] & 255); dy.push(d[1] & 255); face.push(s > 0 ? 1 : s < 0 ? 2 : 0);
  }
  inc.push('.segment "RODATA"', `DIR_X: .byte ${dx.join(',')}`, `DIR_Y: .byte ${dy.join(',')}`, `DIR_FACE: .byte ${face.join(',')}`);
  fs.writeFileSync(path.join(outDir, 'gen.inc'), inc.join('\n') + '\n');
  return { P, C, fixCounts, anchors: [ax0, ax1, ay0, ay1] };
}

module.exports = { gen, DIRS };
