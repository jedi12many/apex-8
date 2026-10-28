// Builds the C64 shoot-'em-up with the kit (c64/kit/build.js):
//   node c64/shmup/build.js      writes c64/out/shmup.prg (the Dreadnought, playable)
// build(dir, { script, defines }) returns a test build instead: it plays script, [[input bits,
// ticks], ...], in place of the controls, then stops with that frame on the screen (at script_park).
// The VICE test (test/shmup-check.js) compares those frames with the reference.
const fs = require('fs'), path = require('path');
const G = require('../../core/shmup.js');
const { gen } = require('./gen.js');
const { assemble, runs, writeOut } = require('../kit/build.js');

const here = __dirname;
const level = G.parse(fs.readFileSync(path.join(here, '..', '..', 'levels', 'shmup', 's1.txt'), 'utf8'));

// Assembles into dir and returns the PRG's bytes; dir also gets the memory map and a VICE label file.
function build(dir = path.join(here, 'build', 'game'), opts = {}) {
  fs.mkdirSync(dir, { recursive: true });
  gen(level, dir);
  return assemble({ src: path.join(here, 'shmup.s'), cfg: path.join(here, 'shmup.cfg'), dir, ...opts });
}

// For test/profile.js: what each MARK in shmup.s ends, and the scripts to profile.
const PROFILE = {
  parts: ['input', 'ship and shots', 'enemies', 'bullets', 'scroll and spawns', 'shot hits', 'ship hits', 'stars',
    'scroll', 'objects', 'sort and multiplexer', null, 'screen copy ahead'],
  scripts: { run: n => require('../../showcase/shmup-pilot.js').inputs(level, n).inputs, sweep: n => require('../../showcase/shmup-pilot.js').sweep(n) },
  name: 'shmup',
};

module.exports = { level, build, runs, PROFILE };

if (require.main === module) {
  const dir = path.join(here, 'build', 'game');
  writeOut('shmup', build(dir), dir);
}
