// Builds the C64 raycaster with the kit (c64/kit/build.js):
//   node c64/build.js            writes c64/out/apex.prg (E1M1, playable)
// build(pose) returns a test build instead: it draws one frame at that pose and stops. The VICE
// test (test/c64-check.js) compares those frames with the reference renderer.
const fs = require('fs'), path = require('path');
const LEVEL = require('../core/level.js');
const { gen } = require('./gen.js');
const { assemble, writeOut } = require('./kit/build.js');

const here = __dirname;
const map = LEVEL.parse(fs.readFileSync(path.join(here, '..', 'levels', 'e1m1.txt'), 'utf8'));

// Assembles into dir and returns the PRG's bytes; dir also gets the memory map and a VICE label file.
// opts.bench: a benchmark build that turns (or with opts.walk, walks forward) for that many frames,
// then parks at bench_done.
// opts.script: [[input bits, ticks], ...] played instead of the joystick (1 fwd, 2 back, 4 left, 8 right).
function build(pose, dir = path.join(here, 'build', pose ? 'test' : 'game'), opts = {}) {
  fs.mkdirSync(dir, { recursive: true });
  gen(map, dir, pose);
  const defines = opts.bench ? { BENCH: opts.bench, BENCH_INPUT: opts.walk ? 1 : 8 } : {};
  return assemble({ src: path.join(here, 'apex.s'), cfg: path.join(here, 'apex.cfg'), dir, script: opts.script, defines });
}

module.exports = { map, build };

if (require.main === module) {
  const dir = path.join(here, 'build', 'game');
  writeOut('apex', build(null, dir), dir, ['CODE', 'TABLES']);
}
