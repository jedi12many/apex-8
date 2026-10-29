// Checks the C64 story engine against the reference: plays the Mountain from a script in VICE and
// compares every pixel of the C64's frame with c64/story/view.js at ticks through it (the dark start,
// typing, pages, the choices and their selection, scene changes, and the pan at every fine scroll);
// then times the run (no late frames) and checks every tick's SID registers, on one SID and two.
//
//   node test/story-check.js <path to VICE folder> [--quick] [--timing] [--ntsc | --model <name>]
const path = require('path');
const kit = require('./kit.js');
const STORY = require('../core/story.js');
const VIEW = require('../c64/story/view.js');
const { load, build, soundOf } = require('../c64/story/build.js');
const { runs } = require('../c64/kit/build.js');

const o = kit.options('node test/story-check.js');
const s = load();

// The script: fire every 70 ticks (the text, then on), and at the choices first down once (and up and
// down again later), so every scene and both kinds of choice come up.
const RUN = 3000;
const inputs = [];
{
  const st = STORY.start(s.c);
  let downs = 0;
  for (let t = 0; t < RUN; t++) {
    let b = 0;
    if (st.phase === 'choose' && !st.blank && t % 70 === 20) b = [2, 1, 2, 0][downs++ % 4];
    else if (t % 70 === 0) b = 16;
    inputs.push(b);
    STORY.play(s.c, st, b);
  }
}
const after = n => { const st = STORY.start(s.c); for (const b of inputs.slice(0, n)) STORY.play(s.c, st, b); return st; };

// Stop at fixed ticks, and the first ticks of each phase and fine scroll seen.
const stops = new Set([1, 10, 17, 60, 150, 300, 600, 900, 1200, 1500, 1800, 2100, 2400, 2700, RUN]);
{
  const st = STORY.start(s.c), seen = new Set();
  inputs.forEach((b, n) => {
    STORY.play(s.c, st, b);
    const key = `${st.phase}${st.blank ? 'dark' : ''}${st.sel}`, ys = `ys${7 - ((st.y8 >> 8) & 7)}`, xs = `xs${(-(st.x8 >> 8)) & 7}`;
    for (const k of [key, ys, xs]) if (!seen.has(k)) { seen.add(k); stops.add(n + 1); }
  });
}
const cases = [...stops].sort((a, b) => a - b).map(n => ({
  name: `tick ${n}`, ticks: n,
  prg: () => build(path.join(o.scratch, 'b'), { script: runs(inputs.slice(0, n)) }, s),
  want: () => VIEW.frame(s.c, s.pics, after(n)).pixels,
}));

const timing = [{ name: 'run', ticks: RUN, build: () => { const d = path.join(o.scratch, 't'); build(d, { script: runs(inputs), defines: { SND_NOSUM: 1 } }, s); return { prg: path.join(d, 'story.prg'), lbl: path.join(d, 'story.lbl') }; } }];
const sound = [1, 2].map(sids => ({
  name: sids === 2 ? 'run, 2 SIDs' : 'run', ticks: RUN,
  build: () => { const d = path.join(o.scratch, `s${sids}`); build(d, { script: runs(inputs), defines: { SND_STEREO: sids - 1 } }, s); return { prg: path.join(d, 'story.prg'), lbl: path.join(d, 'story.lbl') }; },
  sound: () => soundOf(inputs, sids, s),
}));

(async () => {
  let failures = o.timingOnly ? 0 : await kit.checkFrames(o, o.quick ? cases.filter((c, i) => i % 4 === 0) : cases, { border: VIEW.BORDER, width: 10 });
  failures += await kit.checkTiming(o, timing);
  failures += await kit.checkSound(o, sound);
  kit.finish(o, failures, 'the C64 story engine shows every frame and plays every SID tick exactly like the reference');
})().catch(e => { console.error(e.message); process.exit(1); });
