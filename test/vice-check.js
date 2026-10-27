// Runs the C64 raycast stills from showcase/walk.js under VICE and checks each screenshot
// pixel-for-pixel against the reference renderer (VICE's ROM font predicts the status panel).
//
//   node test/vice-check.js <path to VICE folder> [--ntsc] [--cycles 12000000,15000017]
//
// The VICE folder is the one holding bin/x64sc.exe (or bin/x64sc) and C64/.
const fs = require('fs'), os = require('os'), path = require('path');
const { findVice, screenshot, compare } = require('./vice-lib.js');
const APEXSCII = require('../apexscii/apexscii.js');
const { stills } = require('../showcase/walk.js');

const args = process.argv.slice(2);
const viceDir = args.find(a => !a.startsWith('--') && !/^\d/.test(a));
const ntsc = args.includes('--ntsc');
const cyclesArg = args.indexOf('--cycles');
const cycles = cyclesArg >= 0 ? args[cyclesArg + 1].split(',') : ['12000000'];
if (!viceDir) { console.error('usage: node test/vice-check.js <VICE folder> [--ntsc] [--cycles N,N]'); process.exit(2); }

const { exe, rom } = findVice(viceDir);
const shots = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-vice-'));
let failures = 0;
for (const s of stills()) {
  const prg = path.join(shots, `${s.name}.prg`);
  fs.writeFileSync(prg, s.frame.prg());
  for (const limit of cycles) {
    const label = `${s.name}${cycles.length > 1 ? ' @' + limit : ''}`.padEnd(30);
    const shot = path.join(shots, `${s.name}-${limit}.png`);
    if (!screenshot(exe, prg, shot, { ntsc, cycles: limit })) { console.log(`${label} no screenshot (did VICE start?)`); failures++; continue; }
    const r = compare(shot, s.frame.rgba(rom), s.frame.opts.border, APEXSCII.PALETTE);
    console.log(`${label} ${r.bad ? `${r.bad} pixels differ, first at ${r.first}` : 'all 64000 pixels match'}${r.borderOk ? '' : ' · border colour WRONG'}`);
    if (r.bad || !r.borderOk) failures++;
  }
}
fs.rmSync(shots, { recursive: true, force: true });
console.log(failures ? `FAIL: ${failures} screen(s) differ` : `PASS: every frame matches the reference renderer${ntsc ? ' (NTSC)' : ''}`);
process.exitCode = failures ? 1 : 0;
