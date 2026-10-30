// Checks the C64 story engine against the reference: plays the Mountain from a script in VICE and
// compares every pixel of the C64's frame with c64/story/view.js at ticks through it (the dark start,
// typing, pages, the choices and their selection, scene changes, the pan at every fine scroll, and
// every frame of the zoom, the pull-back and the turn); then times the run (no late frames) and checks
// every tick's SID registers, on one SID and two. VICE starts the REU with the frames (the story's REU
// image). Then the scenes with steps again without an REU, where they show their stills; and a last
// check loads the frames from files instead (drive 8), and finds none without an REU.
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
const frames = path.join(o.scratch, 'frames');
build(path.join(o.scratch, 'frames-build'), {}, s);
require('fs').cpSync(path.join(o.scratch, 'frames-build', 'frames'), frames, { recursive: true });
o.vice.reu = path.join(frames, `${s.name}.reu`);

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
const afterNoReu = n => { const st = STORY.start(s.c, { reu: false }); for (const b of inputs.slice(0, n)) STORY.play(s.c, st, b); return st; };
const after = n => { const st = STORY.start(s.c); for (const b of inputs.slice(0, n)) STORY.play(s.c, st, b); return st; };

// Stop at fixed ticks, and the first ticks of each phase and fine scroll seen.
const stops = new Set([1, 10, 17, 60, 150, 300, 600, 900, 1200, 1500, 1800, 2100, 2400, 2700, RUN]);
{
  const st = STORY.start(s.c), seen = new Set();
  inputs.forEach((b, n) => {
    STORY.play(s.c, st, b);
    const key = `${st.phase}${st.blank ? 'dark' : ''}${st.sel}`, ys = `ys${7 - ((st.y8 >> 8) & 7)}`, xs = `xs${(-(st.x8 >> 8)) & 7}`;
    const pic = st.blank ? 'dark' : `pic${STORY.picture(s.c, st)}`;
    for (const k of [key, ys, xs, pic]) if (!seen.has(k)) { seen.add(k); stops.add(n + 1); }
  });
}
const cases = [...stops].sort((a, b) => a - b).map(n => ({
  name: `tick ${n}`, ticks: n,
  prg: () => build(path.join(o.scratch, 'b'), { script: runs(inputs.slice(0, n)) }, s),
  want: () => VIEW.frame(s.c, s.pics, after(n)).pixels,
}));

// without an REU: the first ticks of each scene with steps, and a little into it
const noReu = [];
{
  const st = STORY.start(s.c), seen = new Set();
  inputs.forEach((b, n) => {
    STORY.play(s.c, st, b);
    const sc = s.c.scenes[st.scene];
    if (sc.steps && !seen.has(st.scene)) { seen.add(st.scene); noReu.push(n + 1, n + 20); }
  });
}
const casesNoReu = noReu.map(n => ({
  name: `tick ${n}, no REU`, ticks: n,
  prg: () => build(path.join(o.scratch, 'b'), { script: runs(inputs.slice(0, n)) }, s),
  want: () => VIEW.frame(s.c, s.pics, afterNoReu(n)).pixels,
}));

const timing = [{ name: 'run', ticks: RUN, build: () => { const d = path.join(o.scratch, 't'); build(d, { script: runs(inputs), defines: { SND_NOSUM: 1 } }, s); return { prg: path.join(d, 'story.prg'), lbl: path.join(d, 'story.lbl') }; } }];
const sound = [1, 2].map(sids => ({
  name: sids === 2 ? 'run, 2 SIDs' : 'run', ticks: RUN,
  build: () => { const d = path.join(o.scratch, `s${sids}`); build(d, { script: runs(inputs), defines: { SND_STEREO: sids - 1 } }, s); return { prg: path.join(d, 'story.prg'), lbl: path.join(d, 'story.lbl') }; },
  sound: () => soundOf(inputs, sids, s),
}));

(async () => {
  let failures = o.timingOnly ? 0 : await kit.checkFrames(o, o.quick ? cases.filter((c, i) => i % 4 === 0) : cases, { border: VIEW.BORDER, width: 10 });
  if (!o.quick) failures += o.timingOnly ? 0 : await kit.checkFrames({ ...o, vice: { ...o.vice, reu: false } }, casesNoReu, { border: VIEW.BORDER, width: 18 });
  failures += await kit.checkTiming(o, timing);
  failures += await kit.checkSound(o, sound);
  if (!o.quick) {
    // loading: from the frame files into an empty REU; and with no REU, none
    const V = require('./vice-lib.js'), d = path.join(o.scratch, 'load');
    build(d, { script: [[0, 20]] }, s);
    const lbl = V.labels(path.join(d, 'story.lbl')), prg = path.join(d, 'story.prg');
    for (const [reu, want] of [[true, 1], [false, 0]]) {
      const [got] = await V.readMemory(o.exe, prg, lbl.script_park, lbl.haveframes, 1, { ...o.vice, reu, fs8: frames });
      console.log(`loading the frames ${reu ? 'from drive 8 into an REU' : 'with no REU'}: ${got ? 'all there' : 'none'}${got === want ? '' : ' WRONG'}`);
      if (got !== want) failures++;
    }
  }
  kit.finish(o, failures, 'the C64 story engine shows every frame and plays every SID tick exactly like the reference');
})().catch(e => { console.error(e.message); process.exit(1); });
