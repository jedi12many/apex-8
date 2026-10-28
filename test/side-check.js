// Checks the C64 platformer against the reference: the autopilot (showcase/side-pilot.js) plays the
// level for a number of ticks in a test build, VICE runs it, and every pixel of the frame the C64
// shows must match the reference's frame after the same ticks. Some stops are chosen where the
// player's sprite crosses a raster split, so the splits' timing is checked with the sprite's DMA.
// Then the whole run plays once more to count frames the engine was too late for.
//
//   node test/side-check.js <path to VICE folder> [--ntsc] [--quick]
//
// --quick checks four frames and skips the timing run. Needs cc65 (ca65, ld65) on the PATH.
const fs = require('fs'), os = require('os'), path = require('path');
const { findVice, screenshot, compare, readMemory, labels } = require('./vice-lib.js');
const APEXSCII = require('../apexscii/apexscii.js');
const VIEW = require('../c64/side/view.js');
const { level, build, runs } = require('../c64/side/build.js');
const pilot = require('../showcase/side-pilot.js');

const args = process.argv.slice(2);
const viceDir = args.find(a => !a.startsWith('--'));
const ntsc = args.includes('--ntsc'), quick = args.includes('--quick');
if (!viceDir) { console.error('usage: node test/side-check.js <VICE folder> [--ntsc] [--quick]'); process.exit(2); }

const map = VIEW.compose(level), RUN = 1300;
const all = pilot.inputs(level, RUN).inputs;
// Ticks where the sprite's rows cover the line before a split (its DMA then lands in the split's
// write window): the first of each.
const spriteRows = n => { const { p } = pilot.inputs(level, n), top = VIEW.TOP + (p.y >> 4) - 1; return [top, top + 20]; };
const splitLines = [VIEW.ROWS.hills[0] * 8 - 1, VIEW.TOP - 1, VIEW.LEVEL_SKY - 1];
const crossing = splitLines.map(line => {
  for (let n = 1; n < RUN; n++) { const [a, b] = spriteRows(n); if (a <= line && b >= line) return n; }
  return null;
}).filter(n => n !== null);
const stops = quick ? [0, 200, 650, RUN] : [...new Set([0, 1, 30, 100, 200, 333, 450, 520, 650, 777, 900, 1000, 1111, 1200, RUN, ...crossing])].sort((a, b) => a - b);

(async () => {
  const { exe, rom } = findVice(viceDir);
  const shots = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-side-'));
  let failures = 0;
  for (const n of stops) {
    const dir = path.join(shots, `b${n}`), prg = path.join(shots, `t${n}.prg`), shot = prg.replace(/\.prg$/, '.png');
    fs.writeFileSync(prg, build(dir, { script: runs(all.slice(0, n)) }));
    const { p, cam } = pilot.inputs(level, n);
    const want = VIEW.frame(level, map, p, cam).pixels;
    const label = `tick ${n}${crossing.includes(n) ? ' (sprite on a split)' : ''}`.padEnd(30);
    if (!screenshot(exe, prg, shot, { ntsc, cycles: 4000000 + n * 24000 })) { console.log(`${label} no screenshot (did VICE start?)`); failures++; continue; }
    const r = compare(shot, want, VIEW.BORDER, APEXSCII.PALETTE);
    console.log(`${label} ${r.bad ? `${r.bad} pixels differ, first at ${r.first}` : 'all 64000 pixels match'}${r.borderOk ? '' : ' · border colour WRONG'}`);
    if (r.bad || !r.borderOk) failures++;
  }
  if (!quick) {
    // the whole run: frames shown twice because the next wasn't ready, and the slowest frame
    const dir = path.join(shots, 'timing');
    build(dir, { script: runs(all) });
    const lbl = labels(path.join(dir, 'side.lbl'));
    const [m0, m1] = await readMemory(exe, path.join(dir, 'side.prg'), lbl.script_park, lbl.missed, 2, { ntsc });
    const [c0, c1] = await readMemory(exe, path.join(dir, 'side.prg'), lbl.script_park, lbl.maxcyc, 2, { ntsc });
    const missed = m0 + 256 * m1, slowest = c0 + 256 * c1, frame = ntsc ? 65 * 263 : 63 * 312;
    console.log(`${RUN} ticks: ${missed} late frame(s); the slowest frame was ready ${slowest} cycles after the last (${Math.round((100 * slowest) / frame)}% of a frame)`);
    if (missed) failures++;
  }
  fs.rmSync(shots, { recursive: true, force: true });
  console.log(failures ? `FAIL: ${failures} problem(s)` : `PASS: the C64 platformer shows every frame exactly like the reference, at ${ntsc ? '60 frames a second (NTSC)' : '50 frames a second'}`);
  process.exitCode = failures ? 1 : 0;
})().catch(e => { console.error(e.message); process.exit(1); });
