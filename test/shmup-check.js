// Checks the C64 shoot-'em-up against the reference: the autopilot's run (showcase/shmup-pilot.js),
// and a sweep side to side with fire held that gets the ship shot down (explosions, coming back,
// blinking), play in test builds, VICE runs them, and every pixel of the frame the C64 shows must match the
// reference's frame after the same ticks. Then each whole script plays once more to count frames the
// engine was too late for, and sprites the multiplexer set up too late.
//
//   node test/shmup-check.js <path to VICE folder> [--ntsc] [--quick | --timing]
//
// --quick checks five frames and skips the timing runs; --timing runs only the timing. Needs cc65 (ca65, ld65) on the PATH.
const fs = require('fs'), os = require('os'), path = require('path');
const { findVice, screenshot, compare, readMemory, labels } = require('./vice-lib.js');
const APEXSCII = require('../apexscii/apexscii.js');
const G = require('../core/shmup.js');
const VIEW = require('../c64/shmup/view.js');
const { level, build, runs } = require('../c64/shmup/build.js');
const pilot = require('../showcase/shmup-pilot.js');

const args = process.argv.slice(2);
const viceDir = args.find(a => !a.startsWith('--'));
const ntsc = args.includes('--ntsc'), quick = args.includes('--quick'), timingOnly = args.includes('--timing');
if (!viceDir) { console.error('usage: node test/shmup-check.js <VICE folder> [--ntsc] [--quick | --timing]'); process.exit(2); }

const RUN = 2400, run = pilot.inputs(level, RUN).inputs;
const SWEEP = [];
for (const [bits, n] of [[20, 90], [17, 40], [24, 170], [18, 60], [20, 90], [0, 30], [21, 50], [26, 80]]) for (let k = 0; k < n; k++) SWEEP.push(bits);
const sweep = [];
while (sweep.length < RUN) sweep.push(...SWEEP);
sweep.length = RUN;
const cases = [
  ...(quick ? [0, 1, 300, 1300] : [0, 1, 2, 7, 8, 9, 60, 150, 300, 450, 640, 800, 900, 1050, 1300, 1500, 1760, 1950, 2100, RUN])
    .map(n => ({ name: `run ${n}`, inputs: run.slice(0, n) })),
  ...(quick ? [606] : [601, 606, 620, 665, 668, 700, 1020, 2212, RUN]).map(n => ({ name: `sweep ${n}`, inputs: sweep.slice(0, n) })),
];

(async () => {
  const { exe } = findVice(viceDir);
  const shots = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-shmup-'));
  let failures = 0;
  for (const c of timingOnly ? [] : cases) {
    const dir = path.join(shots, 'b'), prg = path.join(shots, 't.prg'), shot = path.join(shots, 't.png');
    fs.writeFileSync(prg, build(dir, { script: runs(c.inputs) }));
    const g = G.game(level);
    for (const b of c.inputs) G.tick(level, g, b);
    const f = VIEW.frame(level, g);
    const label = c.name.padEnd(11);
    if (!screenshot(exe, prg, shot, { ntsc, cycles: 6000000 + c.inputs.length * 24000 })) { console.log(`${label} no screenshot (did VICE start?)`); failures++; continue; }
    const r = compare(shot, f.pixels, VIEW.COLORS.border, APEXSCII.PALETTE);
    console.log(`${label} ${String(f.sprites.length).padStart(2)} sprites  ${r.bad ? `${r.bad} pixels differ, first at ${r.first}` : 'all 64000 pixels match'}${r.borderOk ? '' : ' · border colour WRONG'}`);
    if (r.bad || !r.borderOk) failures++;
  }
  if (!quick) {
    // each whole script: frames shown twice because the next wasn't ready, sprites set up late, the slowest frame
    for (const [name, inputs] of [['run', run], ['sweep', sweep]]) {
      const dir = path.join(shots, name);
      build(dir, { script: runs(inputs) });
      const lbl = labels(path.join(dir, 'shmup.lbl')), prg = path.join(dir, 'shmup.prg');
      const read = async (addr) => { const [lo, hi] = await readMemory(exe, prg, lbl.script_park, addr, 2, { ntsc }); return lo + 256 * hi; };
      const missed = await read(lbl.missed), late = await read(lbl.latespr), core = await read(lbl.maxcore), slowest = await read(lbl.maxcyc);
      const frame = ntsc ? 65 * 263 : 63 * 312, pc = v => `${Math.round((100 * v) / frame)}%`;
      console.log(`${name} (${inputs.length} ticks): ${missed} late frame(s), ${late} late sprite(s); the slowest frame's work took ${core} cycles (${pc(core)} of a frame), ${slowest} (${pc(slowest)}) with the screen copied ahead into spare time`);
      if (missed || late) failures++;
    }
  }
  fs.rmSync(shots, { recursive: true, force: true });
  console.log(failures ? `FAIL: ${failures} problem(s)` : `PASS: the C64 shoot-'em-up shows every frame exactly like the reference, at ${ntsc ? '60 frames a second (NTSC)' : '50 frames a second'}`);
  process.exitCode = failures ? 1 : 0;
})().catch(e => { console.error(e.message); process.exit(1); });
