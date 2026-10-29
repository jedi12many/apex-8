// Generates the C64 platformer's data from the reference (core/platform.js, c64/side/view.js), so the
// 6502 engine moves the player and draws the screen exactly as the reference does:
//   gen.inc       constants (ca65 source)
//   draw.inc      the band-drawing routines, one per band and screen, unrolled down the rows
//   back.inc      the backdrop update: the forest characters for the shift in X
//   charset.bin   the character set, 2K       sprites.bin  the player, 8 frames (4, then mirrored)
//   level.bin     the level's characters, 16 rows of 256 (one page each)
//   bands.bin     the mountains (5 pages) and hills (4 pages), each row repeated past its width
//   backtab.bin   the backdrop's bytes: for each of its characters' bytes, 16 shifts
//   solid.bin     which blocks are solid, rows of 128
//
// gen(level, dir) writes the files; build.js assembles them.
const fs = require('fs'), path = require('path');
const PLAT = require('../../core/platform.js');
const VIEW = require('./view.js');

// Raster lines: display line y is raster line 51 + y on PAL and NTSC.
const RASTER0 = 51;
// The split writes land this many cycles after the spin sees its raster line: 46 to 60 draw every
// test frame exactly in VICE, on PAL and NTSC, with the sprite on the splits or not.
const SPLIT_DELAY = +(process.env.APEX_SPLIT_DELAY || 53);


// The objects' sprite blocks, from block 8 (coin3 is coin1 again).
const OBJ_FRAMES = ['coin0', 'coin1', 'coin2', 'beetle0', 'beetle1', 'squashed', 'flag0', 'flag1'];

function gen(level, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const L = level, map = VIEW.compose(L), P = PLAT.PHYS;
  if (L.w > 127) throw new Error('level too wide for the C64 engine (127 blocks at most: its rows are pages of 256 characters)');
  if (L.h !== 8) throw new Error('the C64 engine needs levels 8 blocks high (the level band is 16 rows)');
  if (P.width !== 192 || P.height !== 320 || PLAT.BLOCK !== 256) throw new Error('the engine assumes a 12x20 pixel player and 16-pixel blocks');

  // ---------------------------------------------------------------- data files
  fs.writeFileSync(path.join(outDir, 'charset.bin'), Buffer.concat(VIEW.chars.map(g => Buffer.from(g))));

  // The player's 8 frames (4, then mirrored), then the objects': OBJ_FRAMES, from block 8.
  const sprites = Buffer.alloc(16 * 64);
  const put = (block, rows, mirror) => {
    for (let r = 0; r < 21; r++) for (let b = 0; b < 3; b++) {
      let v = 0;
      for (let i = 0; i < 4; i++) v = (v << 2) | rows[r][mirror ? 11 - (4 * b + i) : 4 * b + i];
      sprites[block * 64 + r * 3 + b] = v;
    }
  };
  ['stand', 'run1', 'run2', 'jump'].forEach((name, f) => [false, true].forEach((mirror, m) => put(f + 4 * m, VIEW.FRAMES[name], mirror)));
  OBJ_FRAMES.forEach((name, k) => put(8 + k, VIEW.FRAMES[name], false));
  fs.writeFileSync(path.join(outDir, 'sprites.bin'), sprites);

  // The level: empty cells and the columns past its end take the backdrop character for their row
  // and column.
  const chars = Buffer.alloc(16 * 256);
  for (let cy = 0; cy < 16; cy++) for (let cx = 0; cx < 256; cx++) {
    const code = cx < map.w ? map.map[cy * map.w + cx] : VIEW.EMPTY;
    chars[cy * 256 + cx] = code === VIEW.EMPTY ? VIEW.backKinds[VIEW.backRows[cy]].codes[cx & 3] : code;
  }
  fs.writeFileSync(path.join(outDir, 'level.bin'), chars);

  const bands = Buffer.alloc(9 * 256);
  [[VIEW.FAR, 0], [VIEW.HILLS, 5]].forEach(([b, page]) => {
    for (let cy = 0; cy < b.h; cy++) for (let c = 0; c < b.w + 39; c++) bands[(page + cy) * 256 + c] = b.map[cy * b.w + (c % b.w)];
  });
  fs.writeFileSync(path.join(outDir, 'bands.bin'), bands);

  // Backdrop: its characters' bytes in order (kind, character, byte), each a row of 16, one per shift.
  const backChars = VIEW.backKinds.flatMap(k => k.codes);
  const backtab = Buffer.alloc(backChars.length * 8 * 16);
  for (let s = 0; s < 16; s++) VIEW.backKinds.forEach((_, k) => VIEW.backGlyphs(k, s).forEach((bytes, q) =>
    bytes.forEach((v, b) => { backtab[((k * 4 + q) * 8 + b) * 16 + s] = v; })));
  fs.writeFileSync(path.join(outDir, 'backtab.bin'), backtab);

  const solid = Buffer.alloc(L.h * 128);
  for (let by = 0; by < L.h; by++) for (let bx = 0; bx < L.w; bx++) solid[by * 128 + bx] = L.solid[by * L.w + bx];
  fs.writeFileSync(path.join(outDir, 'solid.bin'), solid);

  // The objects (core/platform.js game): the beetles, and the items (coins, the flag) left to right,
  // with ITEM_FIRST[c]: the first item in block column c or after.
  const G = PLAT.game(L), B = G.beetles, I = G.items;
  if (B.length > 16 || I.length > 120) throw new Error('too many objects for the C64 engine');
  if (L.w > 127) throw new Error("the C64 engine's beetles need a level under 128 blocks across");
  const sy = o => RASTER0 - 1 + VIEW.objectY(o); // a sprite's hardware y
  // no object's sprite on a split's line (the level's top, the sky)
  for (const o of [...B, ...I]) { const top = VIEW.objectY(o); if (top <= VIEW.LEVEL_SKY + 1 && top + 21 >= VIEW.TOP - 1) throw new Error(`an object's sprite at line ${top} crosses a split`); }
  const lo = v => v & 255, hi = v => (v >> 8) & 255;
  const objs = ['.segment "RODATA"'];
  const table = (name, values) => objs.push(`${name}: .byte ${values.length ? values.join(',') : 0}`);
  table('B_X0LO', B.map(o => lo(o.x))); table('B_X0HI', B.map(o => hi(o.x)));
  table('B_YLO', B.map(o => lo(o.y))); table('B_YHI', B.map(o => hi(o.y)));
  table('B_ROWT', B.map(o => o.y >> 8)); table('B_ROWB', B.map(o => (o.y + o.h) >> 8)); table('B_SY', B.map(sy));
  // Each beetle's patrol: the level never changes, so the run of blocks it can walk (open at its height,
  // solid below) is known; it turns where its x would leave [B_MIN, B_MAX] (core/platform.js play).
  const patrol = B.map(o => {
    const top = o.y >> 8, below = (o.y + o.h) >> 8, ok = c => !PLAT.solidAt(L, c, top) && PLAT.solidAt(L, c, below);
    let a = o.x >> 8, b = (o.x + o.w - 1) >> 8;
    if (!ok(a) || !ok(b)) throw new Error('a beetle must start on its own ground');
    while (ok(a - 1)) a--;
    while (ok(b + 1)) b++;
    return [a * 256, (b + 1) * 256 - o.w];
  });
  table('B_MINLO', patrol.map(r => lo(r[0]))); table('B_MINHI', patrol.map(r => hi(r[0])));
  table('B_MAXLO', patrol.map(r => lo(r[1]))); table('B_MAXHI', patrol.map(r => hi(r[1])));
  table('I_COIN', I.map(o => (o.kind === PLAT.COIN ? 1 : 0)));
  table('I_XLO', I.map(o => lo(o.x))); table('I_XHI', I.map(o => hi(o.x)));
  table('I_PXLO', I.map(o => lo(o.x >> 4))); table('I_PXHI', I.map(o => hi(o.x >> 4)));
  table('I_CXLO', I.map(o => lo((o.x + o.w / 2) >> 4))); table('I_CXHI', I.map(o => hi((o.x + o.w / 2) >> 4)));
  table('I_YLO', I.map(o => lo(o.y))); table('I_YHI', I.map(o => hi(o.y)));
  table('I_HLO', I.map(o => lo(o.h))); table('I_HHI', I.map(o => hi(o.h)));
  table('I_SY', I.map(sy));
  const first = [];
  for (let c = 0; c <= L.w + 1; c++) { let k = I.findIndex(o => (o.x >> 8) >= c); first.push(k < 0 ? I.length : k); }
  table('ITEM_FIRST', first);
  objs.push('.segment "CODE"');
  fs.writeFileSync(path.join(outDir, 'objects.inc'), objs.join('\n') + '\n');

  // ---------------------------------------------------------------- code
  // Band drawing: draw_<band>_<screen> draws the band from the column in A, 39 columns across.
  // Each row's source is a page, so only the low bytes of the loads are patched.
  const ROWS = VIEW.ROWS, draw = [];
  for (const [band, src, rows] of [['far', 'BANDS', ROWS.far], ['hills', 'BANDS+5*256', ROWS.hills], ['level', 'LEVEL', ROWS.level]]) {
    for (const scr of ['a', 'b']) {
      const n = rows[1] - rows[0], name = `draw_${band}_${scr}`;
      draw.push(`${name}:`);
      for (let r = 0; r < n; r++) draw.push(`    sta ${name}_${r}+1`);
      draw.push('    ldx #38', `${name}_loop:`);
      for (let r = 0; r < n; r++) draw.push(`${name}_${r}:`, `    lda ${src}+${r}*256,x`, `    sta SCREEN_${scr.toUpperCase()}+${(rows[0] + r) * 40},x`);
      draw.push('    dex', `    bpl ${name}_loop`, '    rts', '');
    }
  }
  fs.writeFileSync(path.join(outDir, 'draw.inc'), draw.join('\n'));

  // Backdrop update: X is the shift.
  const back = [];
  backChars.forEach((code, i) => { for (let b = 0; b < 8; b++) back.push(`    lda BACKTAB+${(i * 8 + b) * 16},x`, `    sta CHARSET+${code * 8 + b}`); });
  fs.writeFileSync(path.join(outDir, 'back.inc'), back.join('\n') + '\n');

  // ---------------------------------------------------------------- constants
  // The colour changes between bands are made in lines whose pixels all come from colour RAM (the
  // bands' ground), so only $D016 needs to change exactly at the boundary.
  const groundLines = (b, rows) => {
    let n = 0;
    for (let y = rows[1] * 8 - 1; y >= rows[0] * 8; y--) {
      const cy = (y >> 3) - rows[0];
      const all3 = Array.from({ length: b.w }, (_, cx) => VIEW.chars[b.map[cy * b.w + cx]][y & 7]).every(v => v === 0xff);
      if (!all3) break;
      n++;
    }
    return n;
  };
  const farGround = groundLines(VIEW.FAR, ROWS.far), hillsGround = groundLines(VIEW.HILLS, ROWS.hills);
  const SPLIT1 = RASTER0 + ROWS.hills[0] * 8, SPLIT2 = RASTER0 + ROWS.level[0] * 8, SKY = RASTER0 + VIEW.LEVEL_SKY;
  const IRQ1 = SPLIT1 - 3, IRQ2 = SPLIT2 - 4, IRQ3 = SKY - 3;
  if (IRQ1 < SPLIT1 - farGround || IRQ2 < SPLIT2 - hillsGround) throw new Error('band colour changes would show');
  const bad = r => (r & 7) === 3;
  if (bad(SKY) || bad(SKY - 1) || bad(IRQ1) || bad(IRQ2) || bad(IRQ3)) throw new Error('a split or its IRQ falls on a bad line');

  const startX = L.start.x * PLAT.BLOCK + (PLAT.BLOCK - P.width) / 2, startY = (L.start.y + 1) * PLAT.BLOCK - P.height;
  const pal = VIEW.PALETTE;
  const C = {
    LEVEL_W: L.w, LEVEL_H: L.h, START_X: startX, START_Y: startY & 0xffff,
    PIT: L.h * PLAT.BLOCK + 64 * PLAT.SUB, MAXCAM: L.w * 16 - PLAT.VIEW, DEAD0: PLAT.DEAD[0], DEAD1: PLAT.DEAD[1],
    ACCEL: P.accel, AIR_ACCEL: P.airAccel, FRICTION: P.friction, MAX_RUN: P.maxRun, GRAVITY: P.gravity, MAX_FALL: P.maxFall,
    JUMP: P.jump, JUMP_CUT: P.jumpCut, COYOTE: P.coyote, BUFFER: P.buffer,
    HILLS_W: VIEW.HILLS.w, FAR_W: VIEW.FAR.w,
    SPLIT1, SPLIT2, SKY, IRQ1, IRQ2, IRQ3, IRQ_BOTTOM: RASTER0 + 200 + 1, SPLIT_DELAY,
    // the sprite: hardware x = (x >> 4) - cam + SPR_X, y = (y >> 4) + SPR_Y, shown while (y >> 4) < SPR_LOW
    SPR_X: 24 - 6, SPR_Y: RASTER0 - 1 + VIEW.TOP + 20 - 21, // (a sprite starts the line after its y)
    SPR_LOW: 200 - (VIEW.TOP + 20 - 21),
    COL_BORDER: VIEW.BORDER,
    FAR_BG: pal.far.bg, FAR_MC1: pal.far.mc1, FAR_MC2: pal.far.mc2, FAR_RAM: pal.far.ram + 8,
    HILLS_BG: pal.hills.bg, HILLS_MC1: pal.hills.mc1, HILLS_MC2: pal.hills.mc2, HILLS_RAM: pal.hills.ram + 8,
    LEVEL_TOP_BG: VIEW.LEVEL_TOP_BG, LEVEL_BG: pal.level.bg, LEVEL_MC1: pal.level.mc1, LEVEL_MC2: pal.level.mc2, LEVEL_RAM: pal.level.ram + 8,
    SPR_MC1: VIEW.SPRITE.mc1, SPR_MC2: VIEW.SPRITE.mc2, SPR_COLOR: VIEW.SPRITE.color,
    // the game
    N_BEETLES: B.length, N_ITEMS: I.length, BEETLE_SPEED: PLAT.BEETLE_SPEED, STOMP: PLAT.STOMP, BOUNCE: PLAT.BOUNCE,
    DYING: PLAT.DYING, INVULN: PLAT.INVULN, WIN_FOR: PLAT.WIN_FOR,
    RESTART_CAM: PLAT.follow(L, PLAT.player(L), L.w * 16), // the camera when a new game starts
    BEETLE_W: PLAT.BOX[PLAT.BEETLE][0], BEETLE_H: PLAT.BOX[PLAT.BEETLE][1], ITEM_W: PLAT.BOX[PLAT.COIN][0],
    COL_COIN: VIEW.OBJ_COLOR[PLAT.COIN], COL_BEETLE: VIEW.OBJ_COLOR[PLAT.BEETLE], COL_FLAG: VIEW.OBJ_COLOR[PLAT.FLAG],
    ...Object.fromEntries(OBJ_FRAMES.map((n, k) => [`F_${n.toUpperCase()}`, 8 + k])),
  };
  if (PLAT.BOX[PLAT.COIN][0] !== PLAT.BOX[PLAT.FLAG][0]) throw new Error('the engine assumes coins and the flag are as wide');
  if (pal.far.bg !== pal.hills.bg || pal.hills.bg !== pal.level.bg) throw new Error('the engine assumes one sky colour');
  const inc = Object.entries(C).map(([k, v]) => `${k} = ${v}`);
  fs.writeFileSync(path.join(outDir, 'gen.inc'), inc.join('\n') + '\n');
  return { map, C };
}

module.exports = { gen, SPLIT_DELAY, OBJ_FRAMES };
