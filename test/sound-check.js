// Checks the C64 SID driver (c64/kit/sid.inc) against the reference (core/sound.js): the sound player
// (c64/sound) plays scripts in VICE, and after each, the checksum of every tick's SID registers and
// the last tick's registers must be the reference's. The scripts: the song alone, effects one at a
// time, and effects piling up (several a tick, and ones cut off by others of higher priority).
//
//   node test/sound-check.js <path to VICE folder> [--ntsc | --model <name>]
//
// Needs cc65 (ca65, ld65) on the PATH.
const path = require('path');
const kit = require('./kit.js');
const { readMemory, labels } = require('./vice-lib.js');
const { song, build, runs, reference } = require('../c64/sound/build.js');

const o = kit.options('node test/sound-check.js');
const E = song.effects.length;
// effects one at a time, each left to finish
const oneByOne = [];
for (let e = 0; e < E; e++) oneByOne.push([1 << e, 1], [0, 90]);
// a deterministic pile-up: every few ticks some effects, often several at once
const pile = [];
let seed = 7;
for (let k = 0; k < 400; k++) {
  seed = (seed * 75 + 74) % 65537;
  pile.push([seed % 3 ? 0 : (seed >> 4) & ((1 << E) - 1), 1 + (seed % 9)]);
}
const scripts = [
  ['the song, 2 loops', [[0, 2 * 32 * song.speed * song.order[0].length + 37]]],
  ['each effect', oneByOne],
  ['effects piling up', pile],
];

(async () => {
  let failures = 0;
  for (const [name, script] of scripts) {
    const dir = path.join(o.scratch, 'b');
    build(dir, { script: runs(script.flatMap(([b, n]) => Array(n).fill(b))) });
    const lbl = labels(path.join(dir, 'sound.lbl')), prg = path.join(dir, 'sound.prg');
    const got = await readMemory(o.exe, prg, lbl.script_park, lbl.snd_img, 25, o.vice);
    const [s0, s1] = await readMemory(o.exe, prg, lbl.script_park, lbl.snd_sum, 2, o.vice);
    const want = reference(script), ticks = script.reduce((t, [, n]) => t + n, 0);
    const sumOk = s0 + 256 * s1 === want.sum, imgOk = got.every((b, i) => b === want.image[i]);
    console.log(`${name.padEnd(20)} ${String(ticks).padStart(5)} ticks: ${sumOk && imgOk ? 'every tick\'s SID registers match' : `checksum ${(s0 + 256 * s1).toString(16)} want ${want.sum.toString(16)}${imgOk ? '' : ', last registers differ'}`}`);
    if (!sumOk || !imgOk) failures++;
  }
  kit.finish(o, failures, 'the SID driver sets every register exactly like the reference');
})().catch(e => { console.error(e.message); process.exit(1); });
