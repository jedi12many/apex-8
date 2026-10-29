// Checks the C64 picture viewer (c64/picture) in VICE: every pixel it shows must be the picture's (the
// APEX-8 splash), decoded here from its Koala file by the multicolor bitmap's rules.
//
//   node test/picture-check.js <path to VICE folder> [--ntsc | --model <name>]
//
// Needs cc65 (ca65, ld65) on the PATH.
const fs = require('fs'), path = require('path');
const kit = require('./kit.js');
const APEXSCII = require('../apexscii/apexscii.js');
const { SPLASH, build } = require('../c64/picture/build.js');

const o = kit.options('node test/picture-check.js');
const PAL = APEXSCII.PALETTE.map(h => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16)));
// The picture: per fat pixel its bit pair picks the background, the screen byte's high or low nibble,
// or the colour RAM byte.
function picture() {
  const k = fs.readFileSync(SPLASH).subarray(2);
  const out = new Uint8ClampedArray(320 * 200 * 4);
  for (let y = 0; y < 200; y++) for (let x = 0; x < 160; x++) {
    const cell = (y >> 3) * 40 + (x >> 2), v = (k[cell * 8 + (y & 7)] >> (6 - 2 * (x & 3))) & 3;
    const c = PAL[[k[10000], k[8000 + cell] >> 4, k[8000 + cell] & 15, k[9000 + cell] & 15][v]];
    for (const dx of [0, 1]) out.set([...c, 255], (y * 320 + 2 * x + dx) * 4);
  }
  return out;
}

(async () => {
  const failures = await kit.checkFrames(o, [{ name: 'splash', ticks: 0, prg: () => build(path.join(o.scratch, 'b')), want: picture }], { border: 0 });
  kit.finish(o, failures, 'the C64 shows the picture exactly');
})().catch(e => { console.error(e.message); process.exit(1); });
