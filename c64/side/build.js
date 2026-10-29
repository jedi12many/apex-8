// Builds the C64 platformer with the kit (c64/kit/build.js):
//   node c64/side/build.js       writes c64/out/side.prg (Green Hills, playable, with its sound)
// build(dir, { script, defines }) returns a test build instead: it plays script, [[input bits,
// ticks], ...], in place of the controls, then stops with that frame on the screen (at script_park).
// The VICE test (test/side-check.js) compares those frames with the reference.
const fs = require('fs'), path = require('path');
const PLAT = require('../../core/platform.js');
const { gen } = require('./gen.js');
const S = require('../../core/sound.js');
const { sidgen } = require('../kit/sidgen.js');
const { assemble, runs, writeOut } = require('../kit/build.js');

const here = __dirname;
const level = PLAT.parse(fs.readFileSync(path.join(here, '..', '..', 'levels', 'side', 'w1.txt'), 'utf8'));

// Assembles into dir and returns the PRG's bytes; dir also gets the memory map and a VICE label file.
function build(dir = path.join(here, 'build', 'game'), opts = {}) {
  fs.mkdirSync(dir, { recursive: true });
  gen(level, dir);
  sidgen(song, dir);
  return assemble({ src: path.join(here, 'side.s'), cfg: path.join(here, 'side.cfg'), dir, ...opts });
}

// The reference's sound for a game played with these inputs, on one SID or two: the game's events each
// tick start their effects (sound/hills.js EVENTS). { sum (core/sound.js checksum), image (the last) }
const SONG = require('../../sound/hills.js'), song = S.compile(SONG);
function soundOf(inputs, sids = 1) {
  const g = PLAT.game(level), p = S.player(song, { sids });
  let sum = 0, image = new Uint8Array(25 * sids);
  for (const b of inputs) {
    PLAT.play(level, g, b);
    image = S.tick(song, p, g.events.flatMap(e => SONG.EVENTS[e] || []).map(n => song.effNames.indexOf(n)));
    sum = S.checksum(sum, image);
  }
  return { sum, image };
}

// For test/profile.js: what each MARK in side.s ends, and the scripts to profile.
const PROFILE = {
  parts: ['input', 'the game', 'sound', 'camera', 'drawing the frame', 'sprites: beetles', 'sprites: seek', 'sprites: picks'],
  scripts: { run: n => require('../../showcase/side-pilot.js').gameInputs(level, n).inputs },
  name: 'side',
};

module.exports = { level, build, runs, soundOf, song, PROFILE };

if (require.main === module) {
  const dir = path.join(here, 'build', 'game');
  writeOut('side', build(dir), dir);
}
