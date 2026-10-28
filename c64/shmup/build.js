// Builds the C64 shoot-'em-up with the kit (c64/kit/build.js):
//   node c64/shmup/build.js      writes c64/out/shmup.prg (the Dreadnought, playable)
// build(dir, { script, defines }) returns a test build instead: it plays script, [[input bits,
// ticks], ...], in place of the controls, then stops with that frame on the screen (at script_park).
// The VICE test (test/shmup-check.js) compares those frames with the reference.
const fs = require('fs'), path = require('path');
const G = require('../../core/shmup.js');
const { gen } = require('./gen.js');
const S = require('../../core/sound.js');
const { assemble, runs, writeOut } = require('../kit/build.js');

const here = __dirname;
const level = G.parse(fs.readFileSync(path.join(here, '..', '..', 'levels', 'shmup', 's1.txt'), 'utf8'));

// Assembles into dir and returns the PRG's bytes; dir also gets the memory map and a VICE label file.
function build(dir = path.join(here, 'build', 'game'), opts = {}) {
  fs.mkdirSync(dir, { recursive: true });
  gen(level, dir);
  return assemble({ src: path.join(here, 'shmup.s'), cfg: path.join(here, 'shmup.cfg'), dir, ...opts });
}

// The reference's sound for a game played with these inputs: the game's events each tick start the
// effects of the same names (sound/shmup.js). { sum (core/sound.js checksum), image (the last) }
const song = S.compile(require('../../sound/shmup.js'));
function soundOf(inputs) {
  const g = G.game(level), p = S.player(song);
  let sum = 0, image = new Uint8Array(25);
  for (const b of inputs) {
    G.tick(level, g, b);
    image = S.tick(song, p, g.events.map(e => song.effNames.indexOf(e)));
    sum = S.checksum(sum, image);
  }
  return { sum, image };
}

// For test/profile.js: what each MARK in shmup.s ends, and the scripts to profile.
const PROFILE = {
  parts: ['input', 'ship and shots', 'enemies', 'bullets', 'scroll and spawns', 'shot hits', 'ship hits', 'stars',
    'scroll', 'objects and words', 'sort and multiplexer', 'sound', 'screen copy ahead'],
  scripts: { run: n => require('../../showcase/shmup-pilot.js').inputs(level, n).inputs, sweep: n => require('../../showcase/shmup-pilot.js').sweep(n) },
  name: 'shmup',
};

module.exports = { level, build, runs, soundOf, song, PROFILE };

if (require.main === module) {
  const dir = path.join(here, 'build', 'game');
  writeOut('shmup', build(dir), dir);
}
