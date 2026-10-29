// Builds the C64 sound player with the kit (c64/kit/build.js) for a song and its effects:
//   node c64/sound/build.js [song]   writes c64/out/sound.prg (the Dreadnought's song) or sound-<song>.prg
//                                    (another song from sound/); the joystick plays the effects
// build(dir, { script, song, sids }) returns a test build instead: script, [[input, ticks], ...], where
// an input starts effect n - 1 for n in bits 0-4 and turns the music off with bit 7, then stops (at
// script_park); sids 1 or 2 fixes one SID or two (otherwise the driver looks for a second). The VICE
// test (test/sound-check.js) compares the SID registers with the reference.
const fs = require('fs'), path = require('path');
const S = require('../../core/sound.js');
const { sidgen } = require('../kit/sidgen.js');
const { assemble, runs, writeOut } = require('../kit/build.js');

const here = __dirname;
const SONGS = ['shmup', 'crypt'];
const songOf = name => S.compile(require(`../../sound/${name}.js`));
const song = songOf('shmup');

function build(dir = path.join(here, 'build', 'game'), opts = {}) {
  const { song: name = 'shmup', sids, defines = {}, ...rest } = opts, c = songOf(name);
  if (sids) defines.SND_STEREO = sids === 2 ? 1 : 0;
  if (c.effects.length > 31) throw new Error('the player starts effects 0-30');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'gen.inc'), '');
  sidgen(c, dir);
  return assemble({ src: path.join(here, 'sound.s'), cfg: path.join(here, 'sound.cfg'), dir, defines, ...rest });
}

// What the reference sets after a script: { image (25 bytes, or 50 for two SIDs), sum (the checksum
// of every tick) }.
function reference(script, name = 'shmup', sids = 1) {
  const c = songOf(name), p = S.player(c, { sids });
  let sum = 0, R = new Uint8Array(25 * sids);
  for (const [input, n] of script) for (let k = 0; k < n; k++) {
    R = S.tick(c, p, input & 31 ? [(input & 31) - 1] : [], !(input & 128));
    sum = S.checksum(sum, R);
  }
  return { image: R, sum };
}

module.exports = { SONGS, song, songOf, build, runs, reference };

if (require.main === module) {
  const dir = path.join(here, 'build', 'game');
  const song = process.argv[2] || 'shmup';
  writeOut(song === 'shmup' ? 'sound' : `sound-${song}`, build(dir, { song }), dir, ['CODE'], 'sound');
}
