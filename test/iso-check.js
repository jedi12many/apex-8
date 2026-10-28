// Checks the C64 dungeon against the reference: the autopilot tour (showcase/iso-pilot.js) and a walk
// in all eight directions play in test builds, VICE runs them, and every pixel of the frame the C64
// shows must match the reference's frame after the same ticks. Then the whole tour plays once more
// to count frames the engine was too late for.
//
//   node test/iso-check.js <path to VICE folder> [--ntsc] [--quick | --timing]
//
// --quick checks four frames and skips the timing run; --timing runs only the timing. Needs cc65 (ca65, ld65) on the PATH.
const fs = require('fs'), os = require('os'), path = require('path');
const { findVice, screenshot, compare, readMemory, labels } = require('./vice-lib.js');
const APEXSCII = require('../apexscii/apexscii.js');
const ISO = require('../core/iso.js');
const VIEW = require('../c64/iso/view.js');
const { map, build, runs } = require('../c64/iso/build.js');
const pilot = require('../showcase/iso-pilot.js');

const args = process.argv.slice(2);
const viceDir = args.find(a => !a.startsWith('--'));
const ntsc = args.includes('--ntsc'), quick = args.includes('--quick'), timingOnly = args.includes('--timing');
if (!viceDir) { console.error('usage: node test/iso-check.js <VICE folder> [--ntsc] [--quick]'); process.exit(2); }

const TOUR = 1800, tour = pilot.inputs(map, pilot.CRYPT_TOUR, TOUR).inputs;
// Eight directions from the start, the diagonals moving the view both ways in one frame, with turns
// on the spot and into walls.
const DANCE = [];
for (const [bits, n] of [[8, 37], [10, 23], [2, 31], [6, 29], [4, 41], [5, 27], [1, 33], [9, 19], [6, 9], [9, 9], [10, 61], [5, 61], [4, 5], [8, 5], [2, 90]])
  for (let k = 0; k < n; k++) DANCE.push(bits);
const cases = [
  ...(quick ? [0, 300, 900] : [0, 1, 4, 60, 150, 300, 450, 600, 750, 900, 1050, 1200, 1350, 1500, 1650, TOUR]).map(n => ({ name: `tour ${n}`, inputs: tour.slice(0, n) })),
  ...(quick ? [DANCE.length] : [100, 260, 380, DANCE.length]).map(n => ({ name: `dance ${n}`, inputs: DANCE.slice(0, n) })),
];

(async () => {
  const { exe } = findVice(viceDir);
  const shots = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-iso-'));
  let failures = 0;
  for (const c of timingOnly ? [] : cases) {
    const dir = path.join(shots, 'b'), prg = path.join(shots, 't.prg'), shot = path.join(shots, 't.png');
    fs.writeFileSync(prg, build(dir, { script: runs(c.inputs) }));
    const hero = ISO.hero(map);
    for (const b of c.inputs) ISO.tick(map, hero, b);
    const want = VIEW.frame(map, hero).pixels;
    const label = c.name.padEnd(12);
    if (!screenshot(exe, prg, shot, { ntsc, cycles: 6000000 + c.inputs.length * 24000 })) { console.log(`${label} no screenshot (did VICE start?)`); failures++; continue; }
    const r = compare(shot, want, VIEW.COLORS.border, APEXSCII.PALETTE);
    console.log(`${label} ${r.bad ? `${r.bad} pixels differ, first at ${r.first}` : 'all 64000 pixels match'}${r.borderOk ? '' : ' · border colour WRONG'}`);
    if (r.bad || !r.borderOk) failures++;
  }
  if (!quick) {
    // the whole tour, then the dance: frames shown twice because the next wasn't ready, and the slowest
    for (const [name, inputs] of [['tour', tour], ['dance', DANCE]]) {
      const dir = path.join(shots, name);
      build(dir, { script: runs(inputs) });
      const lbl = labels(path.join(dir, 'iso.lbl'));
      const [m0, m1] = await readMemory(exe, path.join(dir, 'iso.prg'), lbl.script_park, lbl.missed, 2, { ntsc });
      const [c0, c1] = await readMemory(exe, path.join(dir, 'iso.prg'), lbl.script_park, lbl.maxcyc, 2, { ntsc });
      const missed = m0 + 256 * m1, slowest = c0 + 256 * c1, frame = ntsc ? 65 * 263 : 63 * 312;
      console.log(`${name} (${inputs.length} ticks): ${missed} late frame(s); the slowest frame's work took ${slowest} cycles (${Math.round((100 * slowest) / frame)}% of a frame)`);
      if (missed) failures++;
    }
  }
  fs.rmSync(shots, { recursive: true, force: true });
  console.log(failures ? `FAIL: ${failures} problem(s)` : `PASS: the C64 dungeon shows every frame exactly like the reference, at ${ntsc ? '60 frames a second (NTSC)' : '50 frames a second'}`);
  process.exitCode = failures ? 1 : 0;
})().catch(e => { console.error(e.message); process.exit(1); });
