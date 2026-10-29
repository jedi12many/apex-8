// Builds the C64 raycaster with the kit (c64/kit/build.js):
//   node c64/build.js            writes c64/out/apex.prg (E1M1, playable, with its sound)
// build(pose) returns a test build instead: it draws one frame at that pose and stops. The VICE
// test (test/c64-check.js) compares those frames with the reference renderer.
const fs = require('fs'), path = require('path');
const LEVEL = require('../core/level.js');
const { gen } = require('./gen.js');
const { sidgen } = require('./kit/sidgen.js');
const S = require('../core/sound.js');
const GAME = require('../core/raygame.js');
const VIEW = require('./view.js');
const { assemble, writeOut } = require('./kit/build.js');

const here = __dirname;
const map = LEVEL.parse(fs.readFileSync(path.join(here, '..', 'levels', 'e1m1.txt'), 'utf8'));

// Assembles into dir and returns the PRG's bytes; dir also gets the memory map and a VICE label file.
// opts.bench: a benchmark build that turns (or with opts.walk, walks forward) for that many frames,
// then parks at bench_done.
// opts.script: [[input bits, ticks], ...] played instead of the joystick (1 fwd, 2 back, 4 left, 8 right,
// 16 fire). opts.defines: more ca65 symbols (SND_SYNC: the sound ticks with the game, for its test, and
// the build parks when the script ends; SND_STEREO: 0 or 1 SIDs' worth, without detecting).
function build(pose, dir = path.join(here, 'build', pose ? 'test' : 'game'), opts = {}) {
  fs.mkdirSync(dir, { recursive: true });
  gen(map, dir, pose);
  sidgen(song, dir);
  const defines = { ...(opts.bench ? { BENCH: opts.bench, BENCH_INPUT: opts.walk ? 1 : 8 } : {}), ...(opts.defines || {}) };
  return assemble({ src: path.join(here, 'apex.s'), cfg: path.join(here, 'apex.cfg'), dir, script: opts.script, defines });
}

// The reference's sound for a game played with these inputs, on one SID or two: the game's events each
// tick start their effects (sound/cell.js EVENTS). { sum (core/sound.js checksum), image (the last) }
const SONG = require('../sound/cell.js'), song = S.compile(SONG);
function soundOf(inputs, sids = 1) {
  const g = GAME.game(map), p = S.player(song, { sids });
  let sum = 0, image = new Uint8Array(25 * sids);
  for (const b of inputs) {
    GAME.play(map, g, b, VIEW.caster);
    image = S.tick(song, p, g.events.flatMap(e => SONG.EVENTS[e] || []).map(n => song.effNames.indexOf(n)));
    sum = S.checksum(sum, image);
  }
  return { sum, image };
}

module.exports = { map, build, soundOf, song };

if (require.main === module) {
  const dir = path.join(here, 'build', 'game');
  writeOut('apex', build(null, dir), dir, ['CODE', 'TABLES']);
}
