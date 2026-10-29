// Builds the C64 picture viewer with the kit (c64/kit/build.js):
//   node c64/picture/build.js [picture.kla]   writes c64/out/picture.prg, showing the picture (a Koala
//                                             file; the APEX-8 splash, art/brand/apex8-splash.kla, by
//                                             default)
// build(dir, kla) returns the PRG's bytes. The VICE test (test/picture-check.js) compares what it shows
// with the picture.
const fs = require('fs'), path = require('path');
const { assemble, writeOut } = require('../kit/build.js');

const here = __dirname;
const SPLASH = path.join(here, '..', '..', 'art', 'brand', 'apex8-splash.kla');
function build(dir = path.join(here, 'build', 'game'), kla = SPLASH) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'gen.inc'), `.define PICTURE "${path.resolve(kla).split(path.sep).join('/')}"\n`);
  return assemble({ src: path.join(here, 'picture.s'), cfg: path.join(here, 'picture.cfg'), dir });
}

module.exports = { SPLASH, build };

if (require.main === module) {
  const dir = path.join(here, 'build', 'game');
  writeOut('picture', build(dir, process.argv[2] || SPLASH), dir);
}
