// Builds the C64 story engine with the kit (c64/kit/build.js):
//   node c64/story/build.js [story]   writes c64/out/story.prg (stories/<story>.js, the Mountain by
//                                     default, with its music)
// build(dir, opts) returns a test build instead; opts.script: [[input bits, ticks], ...] (1 up, 2 down,
// 16 fire) played in place of the controls, then the frame stays (at script_park).
const fs = require('fs'), path = require('path');
const S = require('../../core/sound.js');
const STORY = require('../../core/story.js');
const PICS = require('./pictures.js');
const { gen } = require('./gen.js');
const { sidgen } = require('../kit/sidgen.js');
const { assemble, writeOut } = require('../kit/build.js');

const here = __dirname, root = path.join(here, '..', '..');

function load(name = 'mountain') {
  const story = require(path.join(root, 'stories', `${name}.js`));
  const stored = require(path.join(root, 'stories', `${name}-pictures.js`));
  const pics = STORY.pictureList(story).map(({ id }) => PICS.decode(stored[id]));
  const SONG = require(path.join(root, 'sound', `${story.song}.js`));
  return { name, story, pics, c: STORY.compile(story, pics.map(p => [p.cw, p.ch])), SONG, song: S.compile(SONG) };
}

function build(dir, opts = {}, s = load(opts.story)) {
  fs.mkdirSync(dir, { recursive: true });
  gen(s.story, s.pics, dir, s.name);
  sidgen(s.song, dir);
  return assemble({ src: path.join(here, 'story.s'), cfg: path.join(here, 'story.cfg'), dir, script: opts.script, defines: opts.defines });
}

// The reference's sound for these inputs, on one SID or two. { sum, image (the last tick's) }
function soundOf(inputs, sids = 1, s = load()) {
  const st = STORY.start(s.c), p = S.player(s.song, { sids });
  let sum = 0, image = new Uint8Array(25 * sids);
  for (const b of inputs) {
    STORY.play(s.c, st, b);
    image = S.tick(s.song, p, st.events.flatMap(e => (s.c.sounds[e] ? [s.song.effNames.indexOf(s.c.sounds[e])] : [])));
    sum = S.checksum(sum, image);
  }
  return { sum, image };
}

module.exports = { load, build, soundOf };

if (require.main === module) {
  const dir = path.join(here, 'build', 'game');
  writeOut('story', build(dir, {}, load(process.argv[2])), dir, ['CODE', 'RODATA']);
  // the frame files, for the disk
  const out = path.join(here, '..', 'out', 'story');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const frames = path.join(dir, 'frames');
  if (fs.existsSync(frames)) for (const f of fs.readdirSync(frames)) fs.copyFileSync(path.join(frames, f), path.join(out, f));
}
