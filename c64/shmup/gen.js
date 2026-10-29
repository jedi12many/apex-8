// Generates the C64 shoot-'em-up's data and code from the reference (core/shmup.js, c64/shmup/view.js),
// so the 6502 engine plays and draws exactly as the reference does:
//   gen.inc      constants and tables (ca65 source)
//   copy.inc     the screen's row shifts: each row of one screen copied a row down into the other,
//                for each direction, and their table (COPY_LO, COPY_HI: into B, then into A)
//   charset.bin  the level's characters, the status bar's (from view.BAR) and the stars' (as at
//                frame 0)
//   sprites.bin  the sprite frames: view.FRAME_NAMES' 12, then the words (WORDS: the title, PRESS
//                FIRE, GAME OVER)
//   sound.inc    the music and effects (sound/shmup.js), for the kit's SID driver
//   rows.bin     the level's screen: 40 codes a character row, top to bottom
//
// gen(level, dir) writes the files; build.js assembles them.
const fs = require('fs'), path = require('path');
const G = require('../../core/shmup.js');
const VIEW = require('./view.js');
const S = require('../../core/sound.js');
const { sidgen } = require('../kit/sidgen.js');

// The words as sprites, in sprites.bin's order after the frames: [text, x, y, colour, tall].
const WORDS = [...VIEW.TEXT.title, ...VIEW.TEXT.press, ...VIEW.TEXT.over];

const SPRITE_ROWS = 18; // every frame's rows from here are empty, so a hardware sprite is free once its
                        // object's 18th row is drawn (see the multiplexer in shmup.s)

function gen(L, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const P = VIEW.prepare(L);
  if (2 * L.h > 256) throw new Error('level too long for the C64 engine (128 tile rows at most)');

  // ---------------------------------------------------------------- data files
  const charset = Buffer.alloc(2048);
  P.chars.forEach((g, i) => charset.set(g, i * 8));
  fs.writeFileSync(path.join(outDir, 'charset.bin'), charset);
  fs.writeFileSync(path.join(outDir, 'rows.bin'), Buffer.from(P.rows));

  const images = [...VIEW.FRAME_NAMES.map(n => [n, VIEW.FRAMES[n]]), ...WORDS.map(([t, , , , tall]) => [`'${t}'`, VIEW.textImage(t, tall)])];
  const sprites = Buffer.alloc(images.length * 64);
  if (images.length > 32) throw new Error('more than 32 sprite blocks');
  images.forEach(([name, rows], f) => {
    rows.forEach((r, y) => {
      if (y >= SPRITE_ROWS && r.some(v => v)) throw new Error(`sprite ${name}: row ${y} must be empty`);
      for (let b = 0; b < 3; b++) {
        let v = 0;
        for (let i = 0; i < 4; i++) v = (v << 2) | r[4 * b + i];
        sprites[f * 64 + y * 3 + b] = v;
      }
    });
  });
  fs.writeFileSync(path.join(outDir, 'sprites.bin'), sprites);
  sidgen(S.compile(require('../../sound/shmup.js')), outDir);

  // ---------------------------------------------------------------- code
  // copy_<a|b>_<r>: screen <a|b> row r + 1 = the other screen's row r (small parts, so a frame with a
  // little time to spare can still do one), unrolled whole: 8 cycles a character. (11K of code, in
  // the COPY segment, above the level.)
  const copy = ['.segment "COPY"'];
  for (const to of ['B', 'A']) {
    const from = to === 'A' ? 'SCREEN_B' : 'SCREEN_A';
    for (let r = 0; r < 24; r++) {
      copy.push(`copy_${to.toLowerCase()}_${r}:`);
      for (let c = 0; c < 40; c++) copy.push(`    lda ${from}+${r * 40 + c}`, `    sta SCREEN_${to}+${(r + 1) * 40 + c}`);
      copy.push('    rts', '');
    }
  }
  const copies = ['b', 'a'].flatMap(t => Array.from({ length: 24 }, (_, r) => `copy_${t}_${r}`));
  copy.push('.segment "RODATA"', `COPY_LO: .lobytes ${copies.join(',')}`, `COPY_HI: .hibytes ${copies.join(',')}`, '.segment "CODE"', '');
  fs.writeFileSync(path.join(outDir, 'copy.inc'), copy.join('\n') + '\n');

  // ---------------------------------------------------------------- constants and tables
  const byte = v => v & 255;
  const C = {
    LEVEL_ROWS: 2 * L.h, LEVEL_PX: L.px, START_CAMY: L.px - G.SCREEN_H,
    START_X: G.START.x, START_Y: G.START.y, BX0: G.BOUNDS.x0, BX1: G.BOUNDS.x1, BY0: G.BOUNDS.y0, BY1: G.BOUNDS.y1,
    SHOT_SPEED: G.SHOT.speed, SHOT_COOL: G.SHOT.cool, DEAD_FOR: G.DEAD_FOR, INVULN: G.INVULN,
    N_SHOTS: G.SLOTS.shots, N_ENEMIES: G.SLOTS.enemies, N_BULLETS: G.SLOTS.bullets,
    K_DRONE: G.DRONE, K_SWOOPER: G.SWOOPER, K_TURRET: G.TURRET, K_BOOM: G.BOOM,
    GAP: VIEW.GAP, SPRITE_ROWS,
    COL_BORDER: VIEW.COLORS.border, COL_BG: VIEW.COLORS.bg, COL_MC1: VIEW.COLORS.mc1, COL_MC2: VIEW.COLORS.mc2, COL_RAM: VIEW.COLORS.ram + 8,
    SPR_MC1: VIEW.SPRITE.mc1, SPR_MC2: VIEW.SPRITE.mc2,
    STAR: VIEW.STAR,
    MODE_TITLE: G.TITLE, MODE_PLAY: G.PLAY, MODE_OVER: G.OVER, LIVES: G.LIVES, OVER_FOR: G.OVER_FOR,
    F_WORDS: VIEW.FRAME_NAMES.length, W_TITLE: 0, W_PRESS: 4, W_OVER: 8,
    // the status bar: its characters (blank, 0-9, a ship, H, I from BAR), and its columns
    BAR: VIEW.BAR, BAR_SPACE: VIEW.BAR, BAR_0: VIEW.BAR + 1, BAR_SHIP: VIEW.BAR + 11, BAR_H: VIEW.BAR + 12, BAR_I: VIEW.BAR + 13,
    SCORE_COL: VIEW.SCORE_COL, SHIPS_COL: VIEW.SHIPS_COL, HI_COL: VIEW.HI_COL, BAR_LINE: VIEW.BAR_LINE,
  };
  // the screen's first row at the start (view.js scroll)
  const ys0 = (3 - C.START_CAMY) & 7;
  C.START_CY = ((C.START_CAMY + ys0 - 3) >> 3) % C.LEVEL_ROWS;
  // sprite frames and colours
  VIEW.FRAME_NAMES.forEach((n, i) => { C['F_' + n.toUpperCase()] = i; });
  for (const [k, v] of Object.entries({ SHIP: VIEW.COLOR.ship, SHOT: VIEW.COLOR.shot, FLASH: VIEW.COLOR.flash, BULLET: VIEW.COLOR.bullet, BOOM: VIEW.COLOR.boom })) C['C_' + k] = v;
  // Hit tests as ranges of dx = b.x - a.x and dy = b.y - a.y, both bounds exclusive: a.x + a0 < b.x + b1
  // and b.x + b0 < a.x + a1 make a0 - b1 < dx < a1 - b0.
  const pair = (name, a, b) => {
    C[`${name}_X0`] = a[0] - b[1]; C[`${name}_X1`] = a[1] - b[0];
    C[`${name}_Y0`] = a[2] - b[3]; C[`${name}_Y1`] = a[3] - b[2];
  };
  pair('HS_DRONE', G.BOX.shot, G.BOX[G.DRONE]);
  pair('HS_SWOOPER', G.BOX.shot, G.BOX[G.SWOOPER]);
  pair('HS_TURRET', G.BOX.shot, G.BOX[G.TURRET]);
  pair('HP_BULLET', G.BOX.player, G.BOX.bullet);
  pair('HP_DRONE', G.BOX.player, G.BOX[G.DRONE]);
  pair('HP_SWOOPER', G.BOX.player, G.BOX[G.SWOOPER]);

  const inc = Object.entries(C).map(([k, v]) => `${k} = ${v}`);
  const table = (name, values) => inc.push(`${name}: .byte ${values.map(byte).join(',')}`);
  inc.push('.segment "RODATA"');
  const dx = [], dy = [];
  for (let b = 0; b < 16; b++) { const d = G.DIRS[b] || [0, 0]; dx.push(d[0]); dy.push(d[1]); }
  table('DIR_X', dx); table('DIR_Y', dy);
  table('SWAY', G.SWAY);
  table('AIM_VX', G.AIM.map(a => a[0])); table('AIM_VY', G.AIM.map(a => a[1]));
  // the words: per word its x (low, high), y, colour
  table('WORD_XL', WORDS.map(w => w[1] & 255)); table('WORD_XH', WORDS.map(w => w[1] >> 8));
  table('WORD_Y', WORDS.map(w => w[2])); table('WORD_COL', WORDS.map(w => w[3]));
  // the score per enemy kind, in BCD
  table('SCORE_BCD', G.SCORE.map(v => parseInt(String(v), 16)));
  // per enemy kind (0 free, 1 drone, 2 swooper, 3 turret)
  table('HP', G.HP); table('SCORE', G.SCORE);
  table('KIND_FRAME', [0, 0, VIEW.FRAME_NAMES.indexOf('swooper'), VIEW.FRAME_NAMES.indexOf('turret')]);
  table('KIND_COLOR', [0, VIEW.COLOR[G.DRONE], VIEW.COLOR[G.SWOOPER], VIEW.COLOR[G.TURRET]]);
  // spawns by tile row: SPAWN_AT[ty] to SPAWN_AT[ty + 1] index SPAWN_TX and SPAWN_KIND
  const at = [], tx = [], kind = [];
  for (let ty = 0; ty < L.h; ty++) {
    at.push(tx.length);
    for (const s of L.spawns[ty]) { tx.push(s.tx); kind.push(s.kind); }
  }
  at.push(tx.length);
  if (tx.length > 255) throw new Error('too many spawns');
  table('SPAWN_AT', at); table('SPAWN_TX', tx.length ? tx : [0]); table('SPAWN_KIND', kind.length ? kind : [0]);
  // the level's character rows
  inc.push(`ROW_LO: .lobytes ${Array.from({ length: 2 * L.h }, (_, r) => `ROWS+${r * 40}`).join(',')}`);
  inc.push(`ROW_HI: .hibytes ${Array.from({ length: 2 * L.h }, (_, r) => `ROWS+${r * 40}`).join(',')}`);
  // the stars: per texture, each layer's line and its byte
  table('NEAR_LINE', VIEW.NEAR.map(s => s[1])); table('NEAR_BYTE', VIEW.NEAR.map(s => 3 << (6 - 2 * s[0])));
  table('FAR_LINE', VIEW.FAR.map(s => s[1])); table('FAR_BYTE', VIEW.FAR.map(s => 2 << (6 - 2 * s[0])));
  fs.writeFileSync(path.join(outDir, 'gen.inc'), inc.join('\n') + '\n');
  return { P, C };
}

module.exports = { gen, SPRITE_ROWS, WORDS };
