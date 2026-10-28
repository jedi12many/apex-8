// APEX C64 kit, build side: assembling an engine with cc65's ca65 and ld65, and the scripts and
// switches its test builds take. Each engine's build.js generates its data with its own gen.js, then
// calls assemble().
//
//   assemble({ src, cfg, dir, script, defines })   assembles src (with c64/kit on the include path)
//       into dir and returns the PRG's bytes; dir also gets the memory map (.map) and VICE labels (.lbl)
//         script    [[input bits, ticks], ...]: a SCRIPT build plays it in place of the controls, then
//                   stops with that frame on the screen (at script_park)
//         defines   { NAME: value } more constants, e.g. { PROFILE: 1 }
//   runs(inputs)    a list of inputs, one per tick, as [[bits, ticks], ...]
//   writeOut(name, prg, dir, segments)   writes c64/out/<name>.prg and says how big it came out
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');

const KIT = __dirname;

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  if (r.error) throw new Error(`${cmd} not found: install cc65 and put it on the PATH`);
  if (r.status) throw new Error(`${cmd} failed:\n${r.stdout}${r.stderr}`);
  return r.stdout;
}

function assemble({ src, cfg, dir, script, defines = {} }) {
  const name = path.basename(src, '.s'), here = path.dirname(src);
  const extra = Object.entries(defines).map(([k, v]) => `${k} = ${v}`);
  if (script) {
    const pairs = [];
    for (const [bits, n] of script) for (let left = n; left > 0; left -= 255) pairs.push(bits, Math.min(left, 255));
    extra.push('SCRIPT = 1');
    fs.writeFileSync(path.join(dir, 'script.inc'), `    .byte ${[...pairs, 0, 0].join(',')}\n`);
  }
  if (extra.length) fs.appendFileSync(path.join(dir, 'gen.inc'), extra.join('\n') + '\n');
  run('ca65', ['-g', '-I', dir, '-I', KIT, '--bin-include-dir', dir, '-o', path.join(dir, `${name}.o`), src], here);
  run('ld65', ['-C', cfg, '-m', path.join(dir, `${name}.map`), '-Ln', path.join(dir, `${name}.lbl`),
    '-o', path.join(dir, `${name}.prg`), path.join(dir, `${name}.o`)], here);
  return fs.readFileSync(path.join(dir, `${name}.prg`));
}

function runs(inputs) {
  const out = [];
  for (const b of inputs) {
    if (out.length && out[out.length - 1][0] === b) out[out.length - 1][1]++;
    else out.push([b, 1]);
  }
  return out;
}

function writeOut(name, prg, dir, segments = ['CODE']) {
  const out = path.join(KIT, '..', 'out');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, `${name}.prg`), prg);
  const mapFile = fs.readFileSync(path.join(dir, `${name}.map`), 'utf8');
  const seg = n => (mapFile.match(new RegExp(`^${n}\\s+(\\w+)\\s+(\\w+)\\s+(\\w+)`, 'm')) || []).slice(1).join(' ');
  console.log(`c64/out/${name}.prg: ${prg.length} bytes; ${segments.map(n => `${n} ${seg(n)}`).join(', ')}`);
}

module.exports = { assemble, runs, writeOut };
