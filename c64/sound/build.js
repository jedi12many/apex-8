// Builds the C64 sound player with the kit (c64/kit/build.js) for a song and its effects:
//   node c64/sound/build.js      writes c64/out/sound.prg (the Dreadnought's music; the joystick plays
//                                the effects)
// build(dir, { script }) returns a test build instead: script, [[effect bits, ticks], ...], starts
// effect k on the ticks where bit k is set, then stops (at script_park). The VICE test
// (test/sound-check.js) compares the SID registers with the reference.
const fs = require('fs'), path = require('path');
const S = require('../../core/sound.js');
const { sidgen } = require('../kit/sidgen.js');
const { assemble, runs, writeOut } = require('../kit/build.js');

const here = __dirname;
const song = S.compile(require('../../sound/shmup.js'));

function build(dir = path.join(here, 'build', 'game'), opts = {}) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'gen.inc'), '');
  sidgen(song, dir);
  return assemble({ src: path.join(here, 'sound.s'), cfg: path.join(here, 'sound.cfg'), dir, ...opts });
}

// What the reference sets after a script: { image (25 bytes), sum (the checksum of every tick) }.
function reference(script) {
  const p = S.player(song);
  let sum = 0, R = new Uint8Array(25);
  for (const [bits, n] of script) for (let k = 0; k < n; k++) {
    const fx = [];
    for (let e = 0; e < song.effects.length; e++) if (bits & (1 << e)) fx.push(e);
    R = S.tick(song, p, fx);
    sum = S.checksum(sum, R);
  }
  return { image: R, sum };
}

module.exports = { song, build, runs, reference };

if (require.main === module) {
  const dir = path.join(here, 'build', 'game');
  writeOut('sound', build(dir), dir);
}
