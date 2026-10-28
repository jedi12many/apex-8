// Profiles an engine in VICE with the kit's MARKs (c64/kit/kit.inc): plays one of its scripts in a
// PROFILE build and prints how the slowest frame's cycles split between its parts, and the IRQs.
//
//   node test/profile.js <path to VICE folder> <engine> [script] [ticks] [--ntsc | --model <name>]
//
// engine is a folder under c64/ whose build.js exports PROFILE ({ name, parts, scripts }); script is
// one of its scripts (the first by default), played for ticks ticks (2400 by default).
const path = require('path');
const kit = require('./kit.js');
const { readMemory, labels, frameCycles } = require('./vice-lib.js');

const o = kit.options('node test/profile.js');
const [engine, scriptName, ticksArg] = process.argv.slice(2).filter(a => !a.startsWith('--') && a !== o.model).slice(1);
const mod = require(path.join(__dirname, '..', 'c64', engine || '', 'build.js'));
if (!mod.PROFILE) { console.error(`c64/${engine}/build.js has no PROFILE`); process.exit(2); }
const P = mod.PROFILE, name = scriptName || Object.keys(P.scripts)[0], ticks = +(ticksArg || 2400);

(async () => {
  const dir = path.join(o.scratch, 'profile');
  mod.build(dir, { script: mod.runs(P.scripts[name](ticks)), defines: { PROFILE: 1 } });
  const lbl = labels(path.join(dir, `${P.name}.lbl`));
  const b = await readMemory(o.exe, path.join(dir, `${P.name}.prg`), lbl.script_park, lbl.prof, 30, o.vice);
  const word = i => b[2 * i] + 256 * b[2 * i + 1], frame = frameCycles(o.vice);
  console.log(`${engine}, ${name} (${ticks} ticks) on ${o.machine}: the slowest frame was tick ${word(14)}`);
  let total = 0;
  P.parts.forEach((part, i) => {
    if (part === null) return;
    total += word(i);
    console.log(`  ${part.padEnd(24)} ${String(word(i)).padStart(6)}`);
  });
  console.log(`  ${'(of which IRQs)'.padEnd(24)} ${String(word(13)).padStart(6)}`);
  console.log(`  ${'total'.padEnd(24)} ${String(total).padStart(6)}  (${Math.round((100 * total) / frame)}% of a frame, with the marks' own cost)`);
  kit.finish(o, 0, 'profiled');
})().catch(e => { console.error(e.message); process.exit(1); });
