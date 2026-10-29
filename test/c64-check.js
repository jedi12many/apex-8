// Checks the 6502 engine against the reference renderer: builds c64/apex.s in test mode at several
// poses along the walk, runs each in VICE and compares every pixel of the frame the C64 drew itself.
// Scripted builds also play the game (turning, walking, sliding along and into walls, shooting a guard,
// picking up treasure) and must end on the same frame as the same game played here (core/raygame.js),
// and the sound builds must set every tick's SID registers as the reference's sound does, on one SID
// and on two.
//
//   node test/c64-check.js <path to VICE folder> [--quick] [--ntsc | --model <name>]
//
// Needs cc65 (ca65, ld65) on the PATH.
const path = require('path');
const kit = require('./kit.js');
const GAME = require('../core/raygame.js');
const VIEW = require('../c64/view.js');
const { map, build, soundOf } = require('../c64/build.js');
const walk = require('../showcase/walk.js');

const o = kit.options('node test/c64-check.js');

// The game after a script, tick by tick from the start, and then long enough for every timer to run
// out (the C64 goes on ticking with nothing pressed).
function play(script, idle = 60) {
  const g = GAME.game(map);
  for (const [bits, n] of [...script, [0, idle]]) for (let k = 0; k < n; k++) GAME.play(map, g, bits, VIEW.caster);
  return g;
}
const inputs = script => script.flatMap(([bits, n]) => Array(n).fill(bits));
const SCRIPTS = [
  ['turn and walk', [[8, 32], [1, 120], [4, 64], [1, 90]]],
  ['into a wall', [[1, 200], [8, 20], [1, 150], [2, 40]]],
  ['into a guard', [[8, 32], [1, 150]]],
  // turn to a guard and shoot it: it falls (white), then is gone, and the score is 50
  ['shoot a guard', [[8, 32], [16, 1], [0, 30]]],
  // round to the treasure north of the room's middle, shooting the guard on the way
  ['treasure', [[8, 64], [1, 43], [4, 64], [1, 420], [16, 1], [0, 20], [4, 64], [1, 100], [8, 128], [0, 20]]],
];

const route = walk.path(), dir = path.join(o.scratch, 'build');
const frameCase = (name, pose, prg, g = GAME.game(map), cycles = 30000000) => ({
  name, cycles, prg,
  want: () => { const f = VIEW.frame(map, pose, 'mc', VIEW.statusLines(map, pose, g.score), GAME.shown(g)); return f.rgba(o.rom, true); },
});
// A fresh game firing at a pose, with object hit shown white.
const firing = (pose, hit) => { const g = GAME.game(map); g.flash = GAME.FLASH; g.objects[hit].hit = GAME.HIT; return g; };
const aim = { x: 896, y: 2688, a: 128 };
const cases = [
  frameCase('start', map.start, () => build(map.start, dir)),
  ...[60, 150, 200, 230, 290, 350, 480, 570, 700, 900].map(k => frameCase(`walk ${k}`, route[k], () => build(route[k], dir))),
  frameCase('firing', aim, () => build({ ...aim, flash: true, hit: 5 }, dir), firing(aim, 5)),
  ...SCRIPTS.map(([name, script]) => { const g = play(script); return frameCase(name, g.p, () => build(null, dir, { script }), g, 45000000); }),
];

// The sound: the game's scripts with shots and pickups, the SID ticked with the game (SND_SYNC).
const sound = [1, 2].flatMap(sids => SCRIPTS.slice(3).map(([name, script]) => ({
  name: `${name}${sids === 2 ? ', 2 SIDs' : ''}`, ticks: inputs(script).length,
  build: () => {
    const d = path.join(o.scratch, `sound${sids}`);
    build(null, d, { script, defines: { SND_SYNC: 1, SND_STEREO: sids - 1 } });
    return { prg: path.join(d, 'apex.prg'), lbl: path.join(d, 'apex.lbl') };
  },
  sound: () => soundOf(inputs(script), sids),
})));

(async () => {
  const border = VIEW.frame(map, map.start, 'mc', VIEW.statusLines(map, map.start)).opts.border;
  let failures = await kit.checkFrames(o, o.quick ? cases.slice(0, 2).concat(cases.slice(-1)) : cases, { border, width: 14 });
  failures += await kit.checkSound(o, sound);
  kit.finish(o, failures, 'the 6502 raycaster draws every frame and plays every SID tick exactly like the reference');
})().catch(e => { console.error(e.message); process.exit(1); });
