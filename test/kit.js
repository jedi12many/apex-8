// APEX C64 kit, test side: what every engine's VICE check shares. An engine's test lists its cases
// and its timing runs; this builds them, runs VICE, compares and reports.
//
//   options(usage)   the command line: <VICE folder> [--ntsc | --model <name>] [--quick] [--timing]
//                    --model picks a VICE machine (c64, c64c, c64old, ntsc, ntscold, drean, ...)
//   checkFrames(o, cases)   each case { name, prg() -> bytes, want() -> 320x200 RGBA, ticks, note }
//                    runs in VICE (for c.cycles, or 6M plus 24K a tick) and must match pixel for pixel; a
//                    failing case's screenshot is kept in the temp folder's apex-check-failures. A run
//                    that never started the program (VICE's autostart left it at BASIC) runs again
//   checkTiming(o, runs)    each run { name, ticks, build() -> { prg, lbl } } plays to script_park;
//                    reports late frames (missed), late sprites (latespr, where the engine has it)
//                    and the slowest frame (maxcyc, and maxcore where the engine has it)
//   finish(o, failures, what)   the verdict line and exit code
const fs = require('fs'), os = require('os'), path = require('path');
const { findVice, screenshot, compare, readMemory, labels, frameCycles } = require('./vice-lib.js');
const APEXSCII = require('../apexscii/apexscii.js');

function options(usage) {
  const args = process.argv.slice(2), at = args.indexOf('--model');
  const model = at >= 0 ? args[at + 1] : undefined;
  const viceDir = args.find((a, i) => !a.startsWith('--') && (at < 0 || i !== at + 1));
  if (!viceDir) { console.error(`usage: ${usage} <VICE folder> [--ntsc | --model <name>] [--quick] [--timing]`); process.exit(2); }
  const ntsc = args.includes('--ntsc') || /ntsc/.test(model || '');
  const { exe, rom } = findVice(viceDir);
  return {
    exe, rom, model, ntsc, vice: { ntsc, model },
    quick: args.includes('--quick'), timingOnly: args.includes('--timing'),
    scratch: fs.mkdtempSync(path.join(os.tmpdir(), 'apex-check-')),
    failDir: path.join(os.tmpdir(), 'apex-check-failures'),
    machine: model || (ntsc ? 'NTSC' : 'PAL'),
  };
}

async function checkFrames(o, cases, { border, width = 12 } = {}) {
  let failures = 0;
  for (const c of o.timingOnly ? [] : cases) {
    const prg = path.join(o.scratch, 't.prg'), shot = path.join(o.scratch, 't.png');
    fs.writeFileSync(prg, c.prg());
    const label = c.name.padEnd(width), want = c.want(), cycles = c.cycles || 6000000 + (c.ticks || 0) * 24000;
    const run = () => (screenshot(o.exe, prg, shot, { ...o.vice, cycles }) ? compare(shot, want, border, APEXSCII.PALETTE) : null);
    let r = run(), again = '';
    // VICE's autostart now and then leaves the C64 at BASIC's READY prompt: a screen nothing like the
    // frame. Such a run says nothing about the engine, so it runs once more.
    if (!r || (r.bad > 20000 && !r.borderOk)) {
      const first = r;
      r = run();
      again = ` (on a second run: the first ${first ? 'never started the program' : 'gave no screenshot'})`;
    }
    if (!r) { console.log(`${label} no screenshot (did VICE start?)`); failures++; continue; }
    console.log(`${label} ${c.note ? c.note + '  ' : ''}${r.bad ? `${r.bad} pixels differ, first at ${r.first}` : 'all 64000 pixels match'}${r.borderOk ? '' : ' · border colour WRONG'}${again}`);
    if (r.bad || !r.borderOk) {
      failures++;
      const keep = path.join(o.failDir, `${c.name.replace(/\W+/g, '-')}.png`);
      fs.mkdirSync(o.failDir, { recursive: true });
      fs.copyFileSync(shot, keep);
      console.log(`${' '.repeat(width)} (VICE's screenshot kept as ${keep})`);
    }
  }
  return failures;
}

async function checkTiming(o, runs) {
  let failures = 0;
  if (o.quick) return 0;
  const frame = frameCycles(o.vice), pc = v => `${Math.round((100 * v) / frame)}%`;
  for (const r of runs) {
    const { prg, lbl: lblFile } = r.build();
    const lbl = labels(lblFile);
    const read = async addr => { const [lo, hi] = await readMemory(o.exe, prg, lbl.script_park, addr, 2, o.vice); return lo + 256 * hi; };
    const missed = await read(lbl.missed), slowest = await read(lbl.maxcyc);
    const late = lbl.latespr !== undefined ? await read(lbl.latespr) : null;
    const core = lbl.maxcore !== undefined ? await read(lbl.maxcore) : null;
    const work = core !== null
      ? `the slowest frame's work took ${core} cycles (${pc(core)} of a frame), ${slowest} (${pc(slowest)}) with work done ahead into spare time`
      : `the slowest frame's work took ${slowest} cycles (${pc(slowest)} of a frame)`;
    console.log(`${r.name} (${r.ticks} ticks): ${missed} late frame(s)${late !== null ? `, ${late} late sprite(s)` : ''}; ${work}`);
    if (missed || late) failures++;
  }
  return failures;
}

function finish(o, failures, what) {
  fs.rmSync(o.scratch, { recursive: true, force: true });
  console.log(failures ? `FAIL: ${failures} problem(s)` : `PASS: ${what}, on ${o.machine}`);
  process.exitCode = failures ? 1 : 0;
}

module.exports = { options, checkFrames, checkTiming, finish };
