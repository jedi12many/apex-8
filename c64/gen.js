// Generates the C64 engine's data from the reference renderer, so the 6502 code computes exactly the
// same rays and draws exactly the same frames:
//   build/gen.inc     constants and tables (ca65 source)
//   build/charset.bin APEXSCII's multicolor raycast set
//
// Used by c64/build.js; gen(level, testPose) writes the files and returns the expected values.
const fs = require('fs'), path = require('path');
const APEXSCII = require('../apexscii/apexscii.js');
const APEXRAY = require('../core/raycast.js');
const VIEW = require('./view.js');
const SPRITES = require('./sprites.js');

const LEVEL_STRIDE = 32;          // map rows are padded to 32 tiles, so row offsets are a shift
const MOVE_SPEED = 6;             // 8.8 tiles per 50 Hz tick
const HEADING_STEP = 4;           // the player's angle is always a multiple of this

const hex = v => '$' + (v & 0xff).toString(16).padStart(2, '0');
const bytes = (label, arr, per = 16) => {
  const out = [`${label}:`];
  for (let i = 0; i < arr.length; i += per) out.push('    .byte ' + Array.from(arr.slice(i, i + per), hex).join(','));
  return out.join('\n');
};

function gen(map, outDir, testPose) {
  fs.mkdirSync(outDir, { recursive: true });
  const C = VIEW.caster, o = C.opts, rays = o.rays, SCALE = o.scale * 256;
  if (map.w > LEVEL_STRIDE || map.h > 64) throw new Error('level too big for the C64 map (32x64 tiles at most)');

  // 1/|cos| for every angle: SECA[a]; 1/|sin a| is SECA[(a + 768) & 1023].
  const SECA = Array.from({ length: 1024 }, (_, a) => {
    const q = a >> 8, k = a & 255;
    return q & 1 ? APEXRAY.SEC[256 - k] : APEXRAY.SEC[k];
  });
  // Half wall height: the largest j with perp <= TE[j] gives halfH = 2j (rounded down to even, capped).
  const TE = [0xffff, ...Array.from({ length: o.maxH / 2 }, (_, j) => Math.floor(SCALE / (2 * (j + 1))))];
  // JT[perp >> 5] (perp < 16384): the largest j with the bucket's smallest perp <= TE[j]; the engine
  // steps j down from there while perp > TE[j].
  const JT = Array.from({ length: 512 }, (_, i) => { let j = TE.length - 1; while (i * 32 > TE[j]) j--; return j; });
  // Ray states by stored height minus 4 * row, where the stored height is j + 40 (shade A) or j + 168
  // (shade B); CL9 is the left ray's part of the screen code, CL the right ray's.
  const CL = Array.from({ length: 256 }, (_, x) => {
    if (x >= 4 && x <= 80) { const v = x - 40; return v <= 0 ? 0 : Math.min(v, 4); }
    if (x >= 132 && x <= 208) { const v = x - 168; return v <= 0 ? 0 : 4 + Math.min(v, 4); }
    return 0;
  });
  const CL9 = CL.map(s => APEXSCII.RAY.top + 9 * s);
  // Movement per tick along each heading (index a >> 2), signed.
  const MOVX = Array.from({ length: 256 }, (_, i) => (APEXRAY.cos(i * HEADING_STEP) * MOVE_SPEED) >> 8);
  const MOVY = Array.from({ length: 256 }, (_, i) => (APEXRAY.sin(i * HEADING_STEP) * MOVE_SPEED) >> 8);

  // The status panel, exactly as the reference draws it, and where its numbers go.
  const ref = VIEW.frame({ ...map, objects: [] }, map.start, 'mc', VIEW.statusLines(map, map.start));
  const PANEL = ref.screen.slice(VIEW.VIEW_ROWS * 40), PANELC = ref.color.slice(VIEW.VIEW_ROWS * 40);
  const line = VIEW.statusLines(map, map.start)[3], at = s => 1 + line.indexOf(s);
  const pos = { x: at('X ') + 2, y: at('Y ') + 2, h: at('HEADING ') + 8 };
  const digits = s => Array.from(s, ch => APEXSCII.asciiToScreen(ch));
  const tenths = f => Math.round(+(f / 256).toFixed(1) * 10);
  const HEAD = Array.from({ length: 256 }, (_, i) => digits(String(Math.round((i * HEADING_STEP * 360) / 1024) % 360).padStart(3, '0')));
  const LEVEL = new Uint8Array(LEVEL_STRIDE * map.h).fill(1);
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) LEVEL[y * LEVEL_STRIDE + x] = map.cells[y * map.w + x] ? 1 : 0;

  // Objects: each type's images at every size up to its largest, packed 4 fat pixels a byte, rows of
  // bpr bytes, with the numbers cut needs per (type, size).
  const typeNames = Object.keys(SPRITES.TYPES), meta = [], images = [];
  const typeBase = [], typeKmax = [];
  for (const name of typeNames) {
    const T = SPRITES.TYPES[name], kmax = SPRITES.maxSize(T);
    typeBase.push(meta.length); typeKmax.push(kmax);
    for (let k = 0; k <= kmax; k++) {
      const im = SPRITES.image(T, SPRITES.SIZES[k]), bpr = Math.ceil(im.fatW / 4), off = images.length;
      for (let ry = 0; ry < im.rows; ry++) for (let b = 0; b < bpr; b++) {
        let v = 0;
        for (let x = 0; x < 4; x++) { const fx = b * 4 + x; if (fx < im.fatW) v |= im.px[ry * im.fatW + fx] << (6 - 2 * x); }
        images.push(v);
      }
      meta.push({ u: im.u, ey: im.ey, fatW: im.fatW, rows: im.rows, bpr, halfW: (im.fatW * im.u) >> 1, hpx: im.rows * im.ey, off });
    }
  }
  if (meta.some(m => m.hpx > 255 || m.halfW > 255 || m.bpr > 16)) throw new Error('an object image is too big for the C64 tables');
  const objects = map.objects || [];
  if (objects.length > 16) throw new Error('the C64 engine takes 16 objects at most');
  const sw = (label, arr) => [bytes(label + 'LO', arr.map(v => v & 255)), bytes(label + 'HI', arr.map(v => (v >> 8) & 255))];
  const metaWord = (label, f) => [`${label}LO:`, ...meta.map(m => `    .byte <(IMAGES + ${f(m)})`), `${label}HI:`, ...meta.map(m => `    .byte >(IMAGES + ${f(m)})`)];

  const C_ = VIEW.COLOURS.mc;
  const inc = [
    '; generated by c64/gen.js — do not edit',
    `RAYS = ${rays}`, `VIEW_ROWS = ${VIEW.VIEW_ROWS}`, `HALF_ROWS = ${VIEW.VIEW_ROWS / 2}`,
    `SPLIT_LINE = ${51 + 8 * VIEW.VIEW_ROWS}`,
    `COL_BG = ${C_.bg}`, `COL_MC1 = ${C_.mc1}`, `COL_MC2 = ${C_.mc2}`, `COL_WALLB = ${C_.wallB}`, `COL_BORDER = ${C_.border}`,
    `LEVEL_H = ${map.h}`,
    `START_X = ${map.start.x}`, `START_Y = ${map.start.y}`, `START_A = ${map.start.a}`,
    `STATUS_ROW = ${VIEW.VIEW_ROWS + 3}`, `POS_X = ${pos.x}`, `POS_Y = ${pos.y}`, `POS_H = ${pos.h}`,
    ...(testPose ? [`TEST = 1`, `TEST_X = ${testPose.x}`, `TEST_Y = ${testPose.y}`, `TEST_A = ${testPose.a}`] : []),
    '.segment "TABLES"',
    bytes('SECLO', SECA.map(v => v & 255)), bytes('SECHI', SECA.map(v => v >> 8)),
    bytes('CL', CL), bytes('CL9', CL9), bytes('JT0', JT.slice(0, 256)), bytes('JT1', JT.slice(256)),
    '.segment "RODATA"',
    bytes('COLANG_LO', C.COL_ANGLE.map(v => v & 255)), bytes('COLANG_HI', C.COL_ANGLE.map(v => (v >> 8) & 255)),
    bytes('COLCOS', C.COL_COS),
    bytes('TE_LO', TE.map(v => v & 255)), bytes('TE_HI', TE.map(v => v >> 8)),
    bytes('DEC0', Array.from({ length: 33 }, (_, n) => digits(String(n).padStart(2, '0'))[0])),
    bytes('DEC1', Array.from({ length: 33 }, (_, n) => digits(String(n).padStart(2, '0'))[1])),
    bytes('PANEL', PANEL, 40), bytes('PANELC', PANELC, 40),
    bytes('LEVEL', LEVEL, LEVEL_STRIDE),
    `NOBJ = ${objects.length}`, `NSIZES = ${SPRITES.SIZES.length}`,
    `FOCAL = ${Math.round(((rays / 2) * 256) / Math.tan((o.fov * Math.PI) / 360))}`, `SCALE = ${SCALE}`,
    `SPR_MC1 = ${SPRITES.SHARED.mc1}`, `SPR_MC2 = ${SPRITES.SHARED.mc2}`,
    '.segment "HIGH"',
    bytes('MOVX', MOVX.map(v => v & 255)), bytes('MOVY', MOVY.map(v => v & 255)),
    bytes('TENTHD', Array.from({ length: 256 }, (_, f) => digits(String(tenths(f) % 10))[0])),
    bytes('TENTHC', Array.from({ length: 256 }, (_, f) => (tenths(f) === 10 ? 1 : 0))),
    bytes('HEAD0', HEAD.map(d => d[0])), bytes('HEAD1', HEAD.map(d => d[1])), bytes('HEAD2', HEAD.map(d => d[2])),
    ...sw('OBJX', objects.map(ob => ob.x)), ...sw('OBJY', objects.map(ob => ob.y)),
    bytes('OBJT', objects.map(ob => typeNames.indexOf(ob.type))),
    bytes('TYPE_H', typeNames.map(n => SPRITES.TYPES[n].height)), bytes('TYPE_COL', typeNames.map(n => SPRITES.TYPES[n].color)),
    bytes('TYPE_BASE', typeBase), bytes('TYPE_KMAX', typeKmax), bytes('SIZES', SPRITES.SIZES),
    bytes('META_U', meta.map(m => m.u)), bytes('META_EY', meta.map(m => m.ey)), bytes('META_FATW', meta.map(m => m.fatW)),
    bytes('META_ROWS', meta.map(m => m.rows)), bytes('META_BPR', meta.map(m => m.bpr)),
    bytes('META_HALFW', meta.map(m => m.halfW)), bytes('META_HPX', meta.map(m => m.hpx)),
    ...metaWord('META_IMG', m => m.off),
    ...sw('COS', Array.from({ length: 256 }, (_, i) => APEXRAY.cos(i * HEADING_STEP))),
    ...sw('SIN', Array.from({ length: 256 }, (_, i) => APEXRAY.sin(i * HEADING_STEP))),
    bytes('IMAGES', images),
    '',
  ];
  fs.writeFileSync(path.join(outDir, 'gen.inc'), inc.join('\n'));
  fs.writeFileSync(path.join(outDir, 'charset.bin'), Buffer.from(APEXSCII.flatten(APEXSCII.buildDefault('mc', 'ray').glyphs)));
}

module.exports = { gen, MOVE_SPEED, HEADING_STEP };
