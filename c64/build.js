// Builds the C64 engine with cc65's ca65 and ld65:
//   node c64/build.js            writes c64/out/apex.prg (E1M1, playable)
// build(pose) returns a test build instead: it draws one frame at that pose and stops. The VICE
// test (test/c64-check.js) compares those frames with the reference renderer.
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const LEVEL = require('../core/level.js');
const { gen } = require('./gen.js');

const here = __dirname;
const map = LEVEL.parse(fs.readFileSync(path.join(here, '..', 'levels', 'e1m1.txt'), 'utf8'));

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  if (r.error) throw new Error(`${cmd} not found: install cc65 and put it on the PATH`);
  if (r.status) throw new Error(`${cmd} failed:\n${r.stdout}${r.stderr}`);
  return r.stdout;
}

// Assembles into dir and returns the PRG's bytes; dir also gets the map and a VICE label file.
// opts.bench: a benchmark build that turns for that many frames, then parks at bench_done.
// opts.script: [[input bits, ticks], ...] played instead of the joystick (1 fwd, 2 back, 4 left, 8 right).
function build(pose, dir = path.join(here, 'build', pose ? 'test' : 'game'), opts = {}) {
  gen(map, dir, pose);
  const extra = [];
  if (opts.bench) extra.push(`BENCH = ${opts.bench}`);
  if (opts.script) {
    extra.push('SCRIPT = 1', '.segment "RODATA"',
      `SCRIPT_IN: .byte ${[...opts.script.map(s => s[0]), 0].join(',')}`,
      `SCRIPT_N: .byte ${[...opts.script.map(s => s[1]), 0].join(',')}`);
  }
  if (extra.length) fs.appendFileSync(path.join(dir, 'gen.inc'), extra.join('\n') + '\n');
  run('ca65', ['-g', '-I', dir, '--bin-include-dir', dir, '-o', path.join(dir, 'apex.o'), path.join(here, 'apex.s')], here);
  run('ld65', ['-C', path.join(here, 'apex.cfg'), '-m', path.join(dir, 'apex.map'), '-Ln', path.join(dir, 'apex.lbl'),
    '-o', path.join(dir, 'apex.prg'), path.join(dir, 'apex.o')], here);
  return fs.readFileSync(path.join(dir, 'apex.prg'));
}

module.exports = { map, build };

if (require.main === module) {
  const prg = build(null);
  fs.mkdirSync(path.join(here, 'out'), { recursive: true });
  fs.writeFileSync(path.join(here, 'out', 'apex.prg'), prg);
  const mapFile = fs.readFileSync(path.join(here, 'build', 'game', 'apex.map'), 'utf8');
  const seg = n => (mapFile.match(new RegExp(`^${n}\\s+(\\w+)\\s+(\\w+)\\s+(\\w+)`, 'm')) || []).slice(1);
  console.log(`c64/out/apex.prg: ${prg.length} bytes; CODE ${seg('CODE').join(' ')}, TABLES ${seg('TABLES').join(' ')}`);
}
