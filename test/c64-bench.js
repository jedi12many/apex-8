// Measures the 6502 engine's frame rate in VICE: a benchmark build turns on the spot for 64 frames,
// and VICE's monitor stopwatch times them, from the main loop's first pass to the end.
//
//   node test/c64-bench.js <path to VICE folder> [--ntsc] [--walk]
//
// --walk walks forward along the first corridor instead of turning.
//
// Needs cc65 (ca65, ld65) on the PATH.
const fs = require('fs'), os = require('os'), path = require('path');
const { findVice, cyclesBetween, labels: readLabels } = require('./vice-lib.js');
const { build } = require('../c64/build.js');

const FRAMES = 64;
const args = process.argv.slice(2);
const viceDir = args.find(a => !a.startsWith('--'));
const ntsc = args.includes('--ntsc'), walk = args.includes('--walk');
if (!viceDir) { console.error('usage: node test/c64-bench.js <VICE folder> [--ntsc]'); process.exit(2); }

(async () => {
  const { exe } = findVice(viceDir);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-bench-'));
  build(null, dir, { bench: FRAMES, walk });
  const labels = readLabels(path.join(dir, 'apex.lbl'));
  const cycles = await cyclesBetween(exe, path.join(dir, 'apex.prg'), labels.main, labels.bench_done, { ntsc });
  fs.rmSync(dir, { recursive: true, force: true });
  const perFrame = cycles / FRAMES, hz = ntsc ? 1022727 : 985248;
  console.log(`${FRAMES} frames in ${cycles} cycles: ${Math.round(perFrame)} cycles a frame, ` +
    `${(hz / perFrame).toFixed(1)} frames a second (${ntsc ? 'NTSC' : 'PAL'}, ${walk ? 'walking' : 'turning'})`);
})().catch(e => { console.error(e.message); process.exit(1); });
