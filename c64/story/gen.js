// Generates the C64 story engine's data from the reference (core/story.js, c64/story/view.js), so the
// 6502 code shows exactly the same frames:
//   gen.inc     constants, and the story: scenes, pages, lines, choices, speakers (ca65 source)
//   pics.inc    the pictures' rows, packed into the RAM the VIC doesn't need, and their row tables
//   font.bin    the text font: APEXSCII's 64 text glyphs, then the same reversed
//
// Used by c64/story/build.js.
const fs = require('fs'), path = require('path');
const STORY = require('../../core/story.js');
const VIEW = require('./view.js');

// Raster timing: the window ends after line 167 (display line 116). The split polls for it, sets a fine
// scroll that keeps line 168 from being a bad line, then waits so its next write (black) lands in the
// border between lines 167 and 168 (see story.s). Found in VICE: SPLIT_DELAY 4 to 7 shows every test
// frame exactly (2 cuts line 167's right end short, 8 shows line 168's left end); fine scroll 7, where
// line 167's bad line holds the CPU first, passes with SPLIT_DELAY7 0 and 1 (2 shows line 168 now and then).
const SPLIT_DELAY = 5;      // delay loop count from the scroll's write to the black's
const SPLIT_DELAY7 = 0;     // the same at fine scroll 7, before the black's (the bad line holds the CPU)
const TEXT_DELAY = 0;       // (unused)

// Where picture rows can go: RAM the VIC never reads and the program doesn't use. [segment, start, size]
const REGIONS = [['PIC0', 0x0810, 0x07f0], ['PIC1', 0x1000, 0x1000], ['PIC2', 0x8000, 0x0400], ['PIC3', 0x8800, 0x1800], ['PIC4', 0xc000, 0x1000], ['PIC6', 0x4400, 0x03ff], ['PIC5', 0, Infinity]];

const hex = v => '$' + (v & 0xff).toString(16).padStart(2, '0');
const bytes = (label, arr, per = 16) => {
  const out = [`${label}:`];
  if (!arr.length) out.push('    .byte 0');
  for (let i = 0; i < arr.length; i += per) out.push('    .byte ' + Array.from(arr.slice(i, i + per), hex).join(','));
  return out.join('\n');
};
const words = (label, list) => [`${label}_LO:`, ...(list.length ? list : ['0']).map(v => `    .byte <(${v})`), `${label}_HI:`, ...(list.length ? list : ['0']).map(v => `    .byte >(${v})`)].join('\n');

// A run of frames goes to the REU, one 6000-byte frame after another: the window's 15 bitmap rows, its
// 600 screen bytes and its 600 colours. The engine loads them at start-up from files on its disk, each
// a frame (a PRG for $A000), named <prefix>.fNN; or finds them there already, from an REU image
// (<prefix>.reu: the frames, then a 12-byte signature, "APEX" and the prefix), which VICE's -reuimage
// and a C64 Ultimate's REU preload put in the REU before it starts.
const FRAME_BYTES = 6000;

// story: the story module; pics: its pictures, decoded (c64/story/pictures.js decode), in its order.
// prefix: the frame files' name (writes them to outDir/frames). Returns the compiled story.
function gen(story, pics, outDir, prefix = 'story') {
  fs.mkdirSync(outDir, { recursive: true });
  const c = STORY.compile(story, pics.map(p => [p.cw, p.ch]));
  if (c.scenes.length > 255) throw new Error('story: too many scenes');

  // ---------------------------------------------------------------- the story
  const text = [], lineRefs = [], pageLen = [], scPage0 = [], chTables = { go: [], set: [], if: [], unless: [], txt: [] }, scCh0 = [];
  const str = (label, codes) => { text.push(bytes(label, [codes.length, ...codes], 40)); return label; };
  c.scenes.forEach((sc, k) => {
    scPage0.push(pageLen.length);
    sc.pages.forEach((page, p) => {
      pageLen.push(STORY.pageLength(page));
      for (let l = 0; l < STORY.LINES; l++) lineRefs.push(str(`ln_${k}_${p}_${l}`, page[l] || []));
    });
    scCh0.push(chTables.go.length);
    sc.choices.forEach((ch, i) => {
      chTables.go.push(ch.go); chTables.set.push(ch.set & 255); chTables.if.push(ch.if & 255); chTables.unless.push(ch.unless & 255);
      chTables.txt.push(str(`ch_${k}_${i}`, ch.text));
    });
  });
  if (pageLen.length > 255 || chTables.go.length > 255) throw new Error('story: too many pages or choices for the C64 engine');
  const speakers = c.scenes.map((sc, k) => str(`spk_${k}`, sc.speaker));
  const sfx = name => (story.sounds && story.sounds[name] ? `SFX_${story.sounds[name].toUpperCase()}` : '$ff');
  const S = c.scenes;
  // the frames: which pictures they are, their place in the REU, their files
  const frameOf = [], frames = [];
  c.frames.forEach((isFrame, k) => { frameOf.push(isFrame ? frames.length : 255); if (isFrame) frames.push(k); });
  if (frames.length > 254) throw new Error('story: too many frames');
  const names = frames.map((_, f) => `${prefix}.f${String(f).padStart(2, '0')}`);
  if (names.some(n => n.length > 16)) throw new Error("story: the frame files' names are too long");
  fs.rmSync(path.join(outDir, 'frames'), { recursive: true, force: true });
  if (frames.length) fs.mkdirSync(path.join(outDir, 'frames'));
  const sig = `APEX${prefix.toUpperCase().padEnd(8, ' ').slice(0, 8)}`;
  const image = [];
  frames.forEach((k, f) => {
    const p = pics[k], data = Buffer.concat([Buffer.from(p.bitmap), Buffer.from(p.screen), Buffer.from(p.colram)]);
    fs.writeFileSync(path.join(outDir, 'frames', names[f]), Buffer.concat([Buffer.from([0x00, 0xa0]), data]));
    image.push(data);
  });
  if (frames.length) {
    image.push(Buffer.from(sig, 'ascii'));
    let size = 128 * 1024;
    const body = Buffer.concat(image);
    while (size < body.length) size *= 2;
    const reu = Buffer.alloc(size);
    body.copy(reu);
    fs.writeFileSync(path.join(outDir, 'frames', `${prefix}.reu`), reu);
  }
  const st = (f, d = 0) => S.map(s => (s.steps ? f(s.steps) : d));
  const inc = [
    '; generated by c64/story/gen.js — do not edit',
    `NSCENES = ${S.length}`, `START = ${c.start}`, `TYPE_SPEED = ${c.typeSpeed}`, `BLANK = ${STORY.BLANK}`,
    `SPLIT_DELAY = ${SPLIT_DELAY}`, `SPLIT_DELAY7 = ${SPLIT_DELAY7}`, `TEXT_DELAY = ${TEXT_DELAY}`,
    `PROMPT = ${VIEW.PROMPT}`, `NPICS = ${pics.length}`,
    ...VIEW.ROW_COLOR.map((v, r) => `ROW_COLOR${r} = ${v}`),
    '.segment "RODATA"',
    `SND_TYPE = ${sfx('type')}`, `SND_MORE = ${sfx('more')}`, `SND_MOVE = ${sfx('move')}`, `SND_CHOOSE = ${sfx('choose')}`,
    bytes('SC_PIC', S.map(s => s.picture)),
    bytes('SC_X0LO', S.map(s => s.x0 & 255)), bytes('SC_X0HI', S.map(s => s.x0 >> 8)),
    bytes('SC_Y0LO', S.map(s => s.y0 & 255)), bytes('SC_Y0HI', S.map(s => s.y0 >> 8)),
    bytes('SC_DXLO', S.map(s => s.dx & 255)), bytes('SC_DXHI', S.map(s => (s.dx >> 8) & 255)),
    bytes('SC_DYLO', S.map(s => s.dy & 255)), bytes('SC_DYHI', S.map(s => (s.dy >> 8) & 255)),
    bytes('SC_TLO', S.map(s => s.ticks & 255)), bytes('SC_THI', S.map(s => s.ticks >> 8)),
    bytes('SC_SET', S.map(s => s.set & 255)), bytes('SC_NEXT', S.map(s => s.next & 255)),
    bytes('SC_NPAGES', S.map(s => s.pages.length)), bytes('SC_PAGE0', scPage0),
    bytes('SC_NCH', S.map(s => s.choices.length)), bytes('SC_CH0', scCh0),
    bytes('SC_STEPN', st(x => x.count)), bytes('SC_STEPB', st(x => x.base)), bytes('SC_EVERY', st(x => x.every)),
    bytes('SC_REV', st(x => (x.reverse ? 1 : 0))),
    bytes('SC_STILL', st(x => x.still & 255, 255)),
    bytes('SC_SXLO', st(x => x.at[0] & 255)), bytes('SC_SXHI', st(x => x.at[0] >> 8)),
    bytes('SC_SYLO', st(x => x.at[1] & 255)), bytes('SC_SYHI', st(x => x.at[1] >> 8)),
    `NFRAMES = ${frames.length}`, `FRAME_BYTES = ${FRAME_BYTES}`,
    bytes('PIC_FRAME', frameOf),
    bytes('FR_A0', frames.map((_, f) => (f * FRAME_BYTES) & 255)), bytes('FR_A1', frames.map((_, f) => ((f * FRAME_BYTES) >> 8) & 255)),
    bytes('FR_A2', frames.map((_, f) => (f * FRAME_BYTES) >> 16)),
    `SIG_A0 = ${(frames.length * FRAME_BYTES) & 255}`, `SIG_A1 = ${((frames.length * FRAME_BYTES) >> 8) & 255}`, `SIG_A2 = ${(frames.length * FRAME_BYTES) >> 16}`,
    `FR_SIG: .byte "${sig}"`,
    bytes('FRN_LEN', names.map(n => n.length)), words('FRN', names.map((_, f) => `frn_${f}`)),
    ...names.map((n, f) => `frn_${f}: .byte "${n.toUpperCase()}"`),
    words('SC_SPK', speakers),
    bytes('PG_LEN', pageLen), words('LN', lineRefs),
    bytes('CH_GO', chTables.go), bytes('CH_SET', chTables.set), bytes('CH_IF', chTables.if), bytes('CH_UNLESS', chTables.unless),
    words('CH_TXT', chTables.txt),
    ...text,
  ];

  // ---------------------------------------------------------------- the pictures
  // Each picture's bitmap rows (8 bytes a cell), screen rows and colour rows, first fit into REGIONS
  // (largest first); the last region is whatever room is left after the code.
  const rows = [];
  pics.forEach((p, k) => {
    if (c.frames[k]) return;
    for (let r = 0; r < p.ch; r++) {
      const at = r * p.cw;
      rows.push({ label: `bm_${k}_${r}`, data: p.bitmap.subarray(at * 8, (at + p.cw) * 8) });
      rows.push({ label: `sc_${k}_${r}`, data: p.screen.subarray(at, at + p.cw) });
      rows.push({ label: `co_${k}_${r}`, data: p.colram.subarray(at, at + p.cw) });
    }
  });
  const left = REGIONS.map(([, , size]) => size), placed = REGIONS.map(() => []);
  for (const row of [...rows].sort((a, b) => b.data.length - a.data.length)) {
    const k = left.findIndex(n => n >= row.data.length);
    left[k] -= row.data.length;
    placed[k].push(row);
  }
  const pic = [];
  REGIONS.forEach(([seg], k) => { pic.push(`.segment "${seg}"`); for (const row of placed[k]) pic.push(bytes(row.label, row.data, 32)); });
  const row0 = [], ram = pics.map((p, k) => (c.frames[k] ? null : [p, k])).filter(Boolean);
  let n = 0;
  for (const p of pics) { row0.push(n); if (!c.frames[pics.indexOf(p)]) n += p.ch; }
  if (n > 255) throw new Error('story: too many picture rows in all for the C64 engine');
  pic.push('.segment "RODATA"', bytes('PIC_ROW0', row0), bytes('PIC_CW', pics.map(p => p.cw)), bytes('PIC_BG', pics.map(p => p.bg)),
    words('ROW_BM', ram.flatMap(([p, k]) => Array.from({ length: p.ch }, (_, r) => `bm_${k}_${r}`))),
    words('ROW_SC', ram.flatMap(([p, k]) => Array.from({ length: p.ch }, (_, r) => `sc_${k}_${r}`))),
    words('ROW_CO', ram.flatMap(([p, k]) => Array.from({ length: p.ch }, (_, r) => `co_${k}_${r}`))));
  pic.push(`PIC5_SIZE = ${REGIONS.length ? placed[placed.length - 1].reduce((t, r) => t + r.data.length, 0) : 0}`);

  fs.writeFileSync(path.join(outDir, 'gen.inc'), inc.join('\n') + '\n');
  fs.writeFileSync(path.join(outDir, 'pics.inc'), pic.join('\n') + '\n');
  fs.writeFileSync(path.join(outDir, 'font.bin'), Buffer.from(VIEW.FONT.flatMap(g => Array.from(g))));
  return c;
}

module.exports = { gen, FRAME_BYTES, SPLIT_DELAY, SPLIT_DELAY7, TEXT_DELAY };
