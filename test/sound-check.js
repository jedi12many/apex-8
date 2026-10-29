// Checks the C64 SID driver (c64/kit/sid.inc) against the reference (core/sound.js): the sound player
// (c64/sound) plays scripts in VICE for each song (the Dreadnought's, and the Drowned Crypt's, whose
// effects play on all three voices), on one SID and on two (the effects on the second), and after
// each, the checksum of every tick's SID registers and the last tick's registers must be the
// reference's. Then the driver's look for a second SID: it must find none on a plain C64, and one
// when VICE has a second SID at $D420.
//
//   node test/sound-check.js <path to VICE folder> [--ntsc | --model <name>]
//
// Needs cc65 (ca65, ld65) on the PATH.
const path = require('path');
const kit = require('./kit.js');
const { readMemory, labels } = require('./vice-lib.js');
const { SONGS, songOf, build, runs, reference } = require('../c64/sound/build.js');

const o = kit.options('node test/sound-check.js');
// Each song's scripts: the song alone, effects one at a time, effects piling up (one starting every
// few ticks, cutting off others of lower priority on their voice), and the music off and on with
// effects over it.
function scripts(name) {
  const c = songOf(name), E = c.effects.length;
  const oneByOne = [];
  for (let e = 0; e < E; e++) oneByOne.push([e + 1, 1], [0, 90]);
  const pile = [], quiet = [];
  let seed = 7, t = 0;
  for (let k = 0; k < 400; k++) {
    seed = (seed * 75 + 74) % 65537;
    pile.push([seed % 3 ? 0 : 1 + (seed >> 4) % E, 1 + (seed % 9)]);
    // the music off for 300 ticks in every 700
    const n = 1 + (seed % 9);
    quiet.push([(t % 700 < 300 ? 128 : 0) | (seed % 4 ? 0 : 1 + (seed >> 5) % E), n]);
    t += n;
  }
  return [
    ['the song, 2 loops', [[0, 2 * 32 * c.speed * c.order[0].length + 37]]],
    ['each effect', oneByOne],
    ['effects piling up', pile],
    ['music off and on', quiet],
  ];
}

(async () => {
  let failures = 0;
  for (const sids of [1, 2]) for (const name of SONGS) for (const [label, script] of scripts(name)) {
    const dir = path.join(o.scratch, 'b');
    build(dir, { song: name, sids, script: runs(script.flatMap(([b, n]) => Array(n).fill(b))) });
    const lbl = labels(path.join(dir, 'sound.lbl')), prg = path.join(dir, 'sound.prg');
    const got = await readMemory(o.exe, prg, lbl.script_park, lbl.snd_img, 25 * sids, o.vice);
    const [s0, s1] = await readMemory(o.exe, prg, lbl.script_park, lbl.snd_sum, 2, o.vice);
    const want = reference(script, name, sids), ticks = script.reduce((n, [, k]) => n + k, 0);
    const sumOk = s0 + 256 * s1 === want.sum, imgOk = got.length === want.image.length && got.every((b, i) => b === want.image[i]);
    console.log(`${(`${sids} SID${sids > 1 ? 's' : ''}, ${name}: ${label}`).padEnd(34)} ${String(ticks).padStart(5)} ticks: ${sumOk && imgOk ? "every tick's SID registers match" : `checksum ${(s0 + 256 * s1).toString(16)} want ${want.sum.toString(16)}${imgOk ? '' : ', last registers differ'}`}`);
    if (!sumOk || !imgOk) failures++;
  }
  // the look for a second SID, without one and with one at $D420
  for (const sid2 of [false, true]) {
    const dir = path.join(o.scratch, 'd');
    build(dir, { script: runs([0, 0, 0]) });
    const lbl = labels(path.join(dir, 'sound.lbl'));
    const [found] = await readMemory(o.exe, path.join(dir, 'sound.prg'), lbl.script_park, lbl.snd_stereo, 1, { ...o.vice, sid2 });
    const ok = found === (sid2 ? 1 : 0);
    console.log(`${(sid2 ? 'a second SID at $D420' : 'one SID').padEnd(34)} the driver finds ${found ? 'two' : 'one'}${ok ? '' : ': WRONG'}`);
    if (!ok) failures++;
  }
  kit.finish(o, failures, 'the SID driver sets every register exactly like the reference');
})().catch(e => { console.error(e.message); process.exit(1); });
