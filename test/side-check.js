// Checks the C64 platformer against the reference: the autopilot (showcase/side-pilot.js) plays the
// game (coins, beetles, the flag) for a number of ticks in a test build, VICE runs it, and every pixel
// of the frame the C64 shows must match the reference's frame after the same ticks. Some stops are
// chosen where the player's sprite crosses a raster split, so the splits' timing is checked with the
// sprite's DMA, and at the first coin, stomp and win. Then the whole run plays once more, on one SID
// and on two, to count frames the engine was too late for and to check every tick's SID registers
// against the reference's sound (sound/hills.js, played by the game's events).
//
//   node test/side-check.js <path to VICE folder> [--ntsc | --model <name>] [--quick | --timing]
//
// --quick checks four frames and skips the timing run; --timing runs only the timing. Needs cc65
// (ca65, ld65) on the PATH.
const path = require('path');
const kit = require('./kit.js');
const PLAT = require('../core/platform.js');
const VIEW = require('../c64/side/view.js');
const { level, build, runs, soundOf } = require('../c64/side/build.js');
const pilot = require('../showcase/side-pilot.js');

const o = kit.options('node test/side-check.js');
const map = VIEW.compose(level), RUN = 1300;
const all = pilot.gameInputs(level, RUN).inputs;
// The reference's frame after n ticks of the game.
function after(n) {
  const g = PLAT.game(level);
  let cam = PLAT.follow(level, g.p, 0);
  for (const b of all.slice(0, n)) { PLAT.play(level, g, b); cam = PLAT.follow(level, g.p, cam); }
  return { g, cam };
}
// Ticks where the player's sprite covers the line before a split (its DMA then lands in the split's
// write window): the first of each.
const spriteRows = n => { const { g } = after(n), top = VIEW.TOP + (g.p.y >> 4) - 1; return [top, top + 20]; };
const splitLines = [VIEW.ROWS.hills[0] * 8 - 1, VIEW.TOP - 1, VIEW.LEVEL_SKY - 1];
const crossing = splitLines.map(line => {
  for (let n = 1; n < RUN; n++) { const [a, b] = spriteRows(n); if (a <= line && b >= line) return n; }
  return null;
}).filter(n => n !== null);
// Some stops at events: a coin taken, a beetle squashed, the win
const events = [];
{ const g = PLAT.game(level); all.forEach((b, n) => { PLAT.play(level, g, b); for (const e of g.events) if (e !== 'jump' && !events.some(([, k]) => k === e)) events.push([n + 1, e]); }); }
const stops = o.quick ? [0, 200, 650, RUN] : [...new Set([0, 1, 30, 100, 200, 333, 450, 520, 650, 777, 900, 1000, 1111, 1200, RUN, ...crossing, ...events.map(([n]) => n)])].sort((a, b) => a - b);

const cases = stops.map(n => ({
  name: `tick ${n}${crossing.includes(n) ? ' (sprite on a split)' : ''}${events.some(([k]) => k === n) ? ` (${events.find(([k]) => k === n)[1]})` : ''}`, ticks: n,
  prg: () => build(path.join(o.scratch, `b${n}`), { script: runs(all.slice(0, n)) }),
  want: () => { const { g, cam } = after(n); return VIEW.frame(level, map, { ...g.p, hidden: !!(g.invuln & 4) }, cam, VIEW.objectSprites(g, cam)).pixels; },
}));
const timing = [1, 2].map(sids => ({
  name: sids === 2 ? 'run, 2 SIDs' : 'run', ticks: RUN, sound: () => soundOf(all, sids),
  build: () => { const dir = path.join(o.scratch, `timing${sids}`); build(dir, { script: runs(all), defines: { SND_NOSUM: 1, SND_STEREO: sids - 1 } }); return { prg: path.join(dir, 'side.prg'), lbl: path.join(dir, 'side.lbl') }; },
}));
const sound = timing.map(t => ({ ...t, build: () => { const dir = path.join(o.scratch, `sound${t.name.length}`); build(dir, { script: runs(all), defines: { SND_STEREO: t.name.includes('2') ? 1 : 0 } }); return { prg: path.join(dir, 'side.prg'), lbl: path.join(dir, 'side.lbl') }; } }));

(async () => {
  let failures = await kit.checkFrames(o, cases, { border: VIEW.BORDER, width: 30 });
  failures += await kit.checkTiming(o, timing);
  failures += await kit.checkSound(o, sound);
  kit.finish(o, failures, 'the C64 platformer shows every frame and plays every SID tick exactly like the reference, with no late frames');
})().catch(e => { console.error(e.message); process.exit(1); });
