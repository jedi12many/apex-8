// Builds the demo site for GitHub Pages in docs/: the menu (web/index.html), every playable page as a
// single file (web/bundle.js), a still of each demo, and the C64 programs with the APEX-8 disk.
//
//   node web/site.js
//
// The stills of the raycaster and the platformer come from their references; the others are taken from
// the showcase videos (showcase/out/*-run.mp4, with ffmpeg) when they are there, and otherwise kept as
// they were in web/img. Build the C64 programs and the disk (c64/disk.js) first.
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const root = path.join(__dirname, '..'), docs = path.join(root, 'docs'), img = path.join(__dirname, 'img');

require('./bundle.js');
fs.mkdirSync(img, { recursive: true });

// A 320x200 RGBA frame as a PNG at twice the size (ffmpeg writes it).
function png(rgba, file) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', '320x200', '-i', '-',
    '-vf', 'scale=640:400:flags=neighbor', '-frames:v', '1', file], { input: Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength) });
  if (r.status) throw new Error(`ffmpeg failed: ${r.stderr}`);
}

// The raycaster: a guard just shot, the pistol firing. The panel in APEXSCII's text font, as the
// browser page shows it.
{
  const APEXSCII = require('../apexscii/apexscii.js'), VIEW = require('../c64/view.js'), GAME = require('../core/raygame.js');
  const { map } = require('../c64/build.js');
  const g = GAME.game(map);
  for (let k = 0; k < 32; k++) GAME.play(map, g, 8, VIEW.caster);
  GAME.play(map, g, 16, VIEW.caster);
  const text = APEXSCII.buildDefault('hires', 'ray').glyphs, rom = new Uint8Array(2048);
  for (let c = 0; c < 128; c++) for (let y = 0; y < 8; y++) { const v = c < 64 ? text[c][y] : 0; rom[c * 8 + y] = v; rom[(c + 128) * 8 + y] = v ^ 0xff; }
  png(VIEW.frame(map, g.p, 'mc', VIEW.statusLines(map, g.p, g.score), GAME.shown(g)).rgba(rom, true), path.join(img, 'ray.png'));
}
// The platformer: running past coins towards a beetle.
{
  const PLAT = require('../core/platform.js'), VIEW = require('../c64/side/view.js'), { level } = require('../c64/side/build.js');
  const { gameInputs } = require('../showcase/side-pilot.js');
  const g = PLAT.game(level), map = VIEW.compose(level);
  let cam = PLAT.follow(level, g.p, 0);
  for (const b of gameInputs(level, 150).inputs) { PLAT.play(level, g, b); cam = PLAT.follow(level, g.p, cam); }
  png(VIEW.frame(level, map, g.p, cam, VIEW.objectSprites(g, cam)).pixels, path.join(img, 'side.png'));
}
// The others, from their videos (768x544: the screen is 640x400 at 64, 72).
for (const name of ['shmup', 'crypt']) {
  const video = path.join(root, 'showcase', 'out', `${name}-run.mp4`);
  if (!fs.existsSync(video)) { console.log(`(no ${name}-run.mp4: keeping web/img/${name}.png)`); continue; }
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-ss', '8', '-i', video, '-vf', 'crop=640:400:64:72', '-frames:v', '1', path.join(img, `${name}.png`)]);
  if (r.status) throw new Error(`ffmpeg failed: ${r.stderr}`);
}
fs.copyFileSync(path.join(root, 'art', 'brand', 'apex8-splash.png'), path.join(img, 'apex8.png'));

// docs/: the menu, with its links pointed at the site's copies; the pages; the stills; the programs.
fs.rmSync(docs, { recursive: true, force: true });
fs.mkdirSync(path.join(docs, 'img'), { recursive: true });
fs.mkdirSync(path.join(docs, 'c64'), { recursive: true });
const menu = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8').replace(/\.\.\/c64\/out\//g, 'c64/');
fs.writeFileSync(path.join(docs, 'index.html'), menu);
for (const name of ['ray', 'side', 'crypt', 'shmup']) fs.copyFileSync(path.join(__dirname, 'out', `${name}-play.html`), path.join(docs, `${name}.html`));
for (const f of fs.readdirSync(img)) fs.copyFileSync(path.join(img, f), path.join(docs, 'img', f));
for (const f of fs.readdirSync(path.join(root, 'c64', 'out'))) fs.copyFileSync(path.join(root, 'c64', 'out', f), path.join(docs, 'c64', f));
fs.writeFileSync(path.join(docs, '.nojekyll'), '');
console.log(`docs/: ${fs.readdirSync(docs).length} entries`);
