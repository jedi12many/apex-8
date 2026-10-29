// Checks the C64 shoot-'em-up against the reference: the autopilot's run (showcase/shmup-pilot.js),
// and a sweep side to side with fire held that gets the ship shot down (explosions, coming back,
// blinking, game over, the title and a new game), play in test builds; VICE runs them, and every pixel of the frame the C64 shows must
// match the reference's frame after the same ticks. Then each whole script plays once more to count
// frames the engine was too late for and sprites the multiplexer set up too late, and to check every
// tick's SID registers against the reference's sound (sound/shmup.js, played by the game's events), on
// one SID and on two.
//
//   node test/shmup-check.js <path to VICE folder> [--ntsc | --model <name>] [--quick | --timing]
//
// --quick checks five frames and skips the timing runs; --timing runs only the timing. Needs cc65
// (ca65, ld65) on the PATH.
const path = require('path');
const kit = require('./kit.js');
const G = require('../core/shmup.js');
const VIEW = require('../c64/shmup/view.js');
const { level, build, runs, soundOf } = require('../c64/shmup/build.js');
const pilot = require('../showcase/shmup-pilot.js');

const o = kit.options('node test/shmup-check.js');
const RUN = 2400, run = pilot.inputs(level, RUN).inputs;
const sweep = pilot.sweep(RUN);

const frameCase = (name, inputs) => {
  const g = G.game(level);
  for (const b of inputs) G.tick(level, g, b);
  const f = VIEW.frame(level, g);
  return {
    name, ticks: inputs.length, note: `${String(f.sprites.length).padStart(2)} sprites`,
    prg: () => build(path.join(o.scratch, 'b'), { script: runs(inputs) }), want: () => f.pixels,
  };
};
const cases = [
  ...(o.quick ? [0, 1, 300, 1300] : [0, 1, 2, 7, 8, 9, 60, 150, 300, 450, 640, 800, 900, 1050, 1300, 1500, 1760, 1950, 2100, RUN])
    .map(n => frameCase(`run ${n}`, run.slice(0, n))),
  ...(o.quick ? [606, 1300] : [601, 606, 620, 665, 668, 700, 1012, 1020, 1100, 1262, 1300, 1310, 1701, 1702, 2212, RUN]).map(n => frameCase(`sweep ${n}`, sweep.slice(0, n))),
];
// each script on one SID and on two (a C64 Ultimate's: the effects on the second)
const timing = [['run', run], ['sweep', sweep]].flatMap(([name, inputs]) => [1, 2].map(sids => ({
  name: sids === 2 ? `${name}, 2 SIDs` : name, ticks: inputs.length, inputs, sids, sound: () => soundOf(inputs, sids),
  build: () => { const dir = path.join(o.scratch, `${name}${sids}`); build(dir, { script: runs(inputs), defines: { SND_NOSUM: 1, SND_STEREO: sids - 1 } }); return { prg: path.join(dir, 'shmup.prg'), lbl: path.join(dir, 'shmup.lbl') }; },
})));
const sound = timing.map(t => ({ ...t, build: () => { const dir = path.join(o.scratch, `${t.name}-sound`.replace(/\W+/g, '-')); build(dir, { script: runs(t.inputs), defines: { SND_STEREO: t.sids - 1 } }); return { prg: path.join(dir, 'shmup.prg'), lbl: path.join(dir, 'shmup.lbl') }; } }));

(async () => {
  let failures = await kit.checkFrames(o, cases, { border: VIEW.COLORS.border });
  failures += await kit.checkTiming(o, timing);
  failures += await kit.checkSound(o, sound);
  kit.finish(o, failures, "the C64 shoot-'em-up shows every frame exactly like the reference, with no late frames or sprites");
})().catch(e => { console.error(e.message); process.exit(1); });
