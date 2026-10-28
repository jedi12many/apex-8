// Builds the C64 isometric dungeon with cc65's ca65 and ld65:
//   node c64/iso/build.js        writes c64/out/iso.prg (the Crypt, playable)
// build(dir, { script }) returns a test build instead: it plays script, [[input bits, ticks], ...],
// in place of the controls, then stops with that frame on the screen (at script_park). The VICE test
// (test/iso-check.js) compares those frames with the reference.
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const ISO = require('../../core/iso.js');
const { gen } = require('./gen.js');

const here = __dirname;
const map = ISO.parse(fs.readFileSync(path.join(here, '..', '..', 'levels', 'iso', 'd1.txt'), 'utf8'));

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  if (r.error) throw new Error(`${cmd} not found: install cc65 and put it on the PATH`);
  if (r.status) throw new Error(`${cmd} failed:\n${r.stdout}${r.stderr}`);
  return r.stdout;
}

// Assembles into dir and returns the PRG's bytes; dir also gets the map and a VICE label file.
function build(dir = path.join(here, 'build', 'game'), opts = {}) {
  gen(map, dir);
  if (opts.script) {
    const pairs = [];
    for (const [bits, n] of opts.script) for (let left = n; left > 0; left -= 255) pairs.push(bits, Math.min(left, 255));
    fs.appendFileSync(path.join(dir, 'gen.inc'), 'SCRIPT = 1\n');
    fs.writeFileSync(path.join(dir, 'script.inc'), `    .byte ${[...pairs, 0, 0].join(',')}\n`);
  }
  run('ca65', ['-g', '-I', dir, '--bin-include-dir', dir, '-o', path.join(dir, 'iso.o'), path.join(here, 'iso.s')], here);
  run('ld65', ['-C', path.join(here, 'iso.cfg'), '-m', path.join(dir, 'iso.map'), '-Ln', path.join(dir, 'iso.lbl'),
    '-o', path.join(dir, 'iso.prg'), path.join(dir, 'iso.o')], here);
  return fs.readFileSync(path.join(dir, 'iso.prg'));
}

// Inputs as runs: [[bits, ticks], ...].
function runs(inputs) {
  const out = [];
  for (const b of inputs) {
    if (out.length && out[out.length - 1][0] === b) out[out.length - 1][1]++;
    else out.push([b, 1]);
  }
  return out;
}

module.exports = { map, build, runs };

if (require.main === module) {
  const prg = build();
  const out = path.join(here, '..', 'out');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'iso.prg'), prg);
  const mapFile = fs.readFileSync(path.join(here, 'build', 'game', 'iso.map'), 'utf8');
  const seg = n => (mapFile.match(new RegExp(`^${n}\\s+(\\w+)\\s+(\\w+)\\s+(\\w+)`, 'm')) || []).slice(1);
  console.log(`c64/out/iso.prg: ${prg.length} bytes; CODE ${seg('CODE').join(' ')}`);
}
