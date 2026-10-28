// Builds the C64 platformer with the kit (c64/kit/build.js):
//   node c64/side/build.js       writes c64/out/side.prg (Green Hills, playable)
// build(dir, { script, defines }) returns a test build instead: it plays script, [[input bits,
// ticks], ...], in place of the controls, then stops with that frame on the screen (at script_park).
// The VICE test (test/side-check.js) compares those frames with the reference.
const fs = require('fs'), path = require('path');
const PLAT = require('../../core/platform.js');
const { gen } = require('./gen.js');
const { assemble, runs, writeOut } = require('../kit/build.js');

const here = __dirname;
const level = PLAT.parse(fs.readFileSync(path.join(here, '..', '..', 'levels', 'side', 'w1.txt'), 'utf8'));

// Assembles into dir and returns the PRG's bytes; dir also gets the memory map and a VICE label file.
function build(dir = path.join(here, 'build', 'game'), opts = {}) {
  fs.mkdirSync(dir, { recursive: true });
  gen(level, dir);
  return assemble({ src: path.join(here, 'side.s'), cfg: path.join(here, 'side.cfg'), dir, ...opts });
}

module.exports = { level, build, runs };

if (require.main === module) {
  const dir = path.join(here, 'build', 'game');
  writeOut('side', build(dir), dir);
}
