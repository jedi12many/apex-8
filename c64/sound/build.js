// Builds the C64 sound player with the kit (c64/kit/build.js) for a song and its effects:
//   node c64/sound/build.js [song]   writes c64/out/sound.prg (a song from sound/, the Dreadnought's
//                                    by default; the joystick plays the effects)
// build(dir, { script, song }) returns a test build instead: script, [[input, ticks], ...], where an
// input starts effect n - 1 for n in bits 0-4 and turns the music off with bit 7, then stops (at
// script_park). The VICE test (test/sound-check.js) compares the SID registers with the reference.
const fs = require('fs'), path = require('path');
const S = require('../../core/sound.js');
const { sidgen } = require('../kit/sidgen.js');
const { assemble, runs, writeOut } = require('../kit/build.js');

const here = __dirname;
const SONGS = ['shmup', 'crypt'];
const songOf = name => S.compile(require(`../../sound/${name}.js`));
const song = songOf('shmup');

function build(dir = path.join(here, 'build', 'game'), opts = {}) {
  const { song: name = 'shmup', ...rest } = opts, c = songOf(name);
  if (c.effects.length > 31) throw new Error('the player starts effects 0-30');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'gen.inc'), '');
  sidgen(c, dir);
  return assemble({ src: path.join(here, 'sound.s'), cfg: path.join(here, 'sound.cfg'), dir, ...rest });
}

// What the reference sets after a script: { image (25 bytes), sum (the checksum of every tick) }.
function reference(script, name = 'shmup') {
  const c = songOf(name), p = S.player(c);
  let sum = 0, R = new Uint8Array(25);
  for (const [input, n] of script) for (let k = 0; k < n; k++) {
    R = S.tick(c, p, input & 31 ? [(input & 31) - 1] : [], !(input & 128));
    sum = S.checksum(sum, R);
  }
  return { image: R, sum };
}

module.exports = { SONGS, song, songOf, build, runs, reference };

if (require.main === module) {
  const dir = path.join(here, 'build', 'game');
  writeOut('sound', build(dir, { song: process.argv[2] || 'shmup' }), dir);
}
