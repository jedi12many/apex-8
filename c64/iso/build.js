// Builds the C64 isometric dungeon with the kit (c64/kit/build.js):
//   node c64/iso/build.js        writes c64/out/iso.prg (the Crypt, playable)
// build(dir, { script, defines }) returns a test build instead: it plays script, [[input bits,
// ticks], ...], in place of the controls, then stops with that frame on the screen (at script_park).
// The VICE test (test/iso-check.js) compares those frames with the reference.
const fs = require('fs'), path = require('path');
const ISO = require('../../core/iso.js');
const { gen } = require('./gen.js');
const { assemble, runs, writeOut } = require('../kit/build.js');

const here = __dirname;
const map = ISO.parse(fs.readFileSync(path.join(here, '..', '..', 'levels', 'iso', 'd1.txt'), 'utf8'));

// Assembles into dir and returns the PRG's bytes; dir also gets the memory map and a VICE label file.
function build(dir = path.join(here, 'build', 'game'), opts = {}) {
  fs.mkdirSync(dir, { recursive: true });
  gen(map, dir);
  return assemble({ src: path.join(here, 'iso.s'), cfg: path.join(here, 'iso.cfg'), dir, ...opts });
}

module.exports = { map, build, runs };

if (require.main === module) {
  const dir = path.join(here, 'build', 'game');
  writeOut('iso', build(dir), dir);
}
