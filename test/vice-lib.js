// Shared VICE helpers for the tests: find x64sc and the ROM font, take a screenshot of a PRG, and
// compare a screenshot pixel-for-pixel with an expected 320x200 RGBA screen.
// VICE uses its own palette, so each expected colour may map to exactly one VICE colour; any wrong
// character, colour, sprite or misplaced raster split shows up as differing pixels.
const fs = require('fs'), path = require('path'), zlib = require('zlib'), net = require('net');
const { spawn, spawnSync } = require('child_process');

function findVice(dir) {
  const exe = ['x64sc.exe', 'x64sc'].map(f => path.join(dir, 'bin', f)).find(f => fs.existsSync(f));
  const romFile = path.join(dir, 'C64', 'chargen-901225-01.bin');
  if (!exe || !fs.existsSync(romFile)) throw new Error(`x64sc or C64/chargen-901225-01.bin not found under ${dir}`);
  return { exe, rom: fs.readFileSync(romFile).subarray(0, 2048) };
}

// The machine VICE emulates: a model by name (VICE's -model: c64, c64c, c64old, ntsc, newntsc,
// oldntsc, drean, ...), or the default PAL C64 or NTSC.
// The remote monitor's port (APEX_MONITOR_PORT to run two at once).
const PORT = +(process.env.APEX_MONITOR_PORT || 6510);
const machine = ({ ntsc, model }) => (model ? ['-model', model] : ntsc ? ['-ntsc'] : []);
// Cycles per frame on each machine: PAL 63 x 312, NTSC 65 x 263, old NTSC 64 x 262, Drean (PAL-N)
// 65 x 312.
const FRAME_CYCLES = { pal: 19656, c64: 19656, c64c: 19656, c64old: 19656, c64gs: 19656, ntsc: 17095, newntsc: 17095, jap: 17095, oldntsc: 16768, drean: 20280 };
const frameCycles = ({ ntsc, model }) => FRAME_CYCLES[model || (ntsc ? 'ntsc' : 'pal')] || 19656;

// Run a PRG for `cycles` and save VICE's screenshot of the last frame; returns false if none appeared.
function screenshot(exe, prg, shot, { ntsc = false, model, cycles = '12000000' } = {}) {
  try { fs.unlinkSync(shot); } catch (e) { /* not there yet */ }
  spawnSync(exe, ['-default', '-warp', '-sounddev', 'dummy', '+confirmonexit', '-autostartprgmode', '1',
    ...machine({ ntsc, model }), '-limitcycles', String(cycles), '-exitscreenshot', shot, '-autostart', prg], { timeout: 120000 });
  return fs.existsSync(shot);
}

// Minimal PNG reader: 8-bit RGB, RGBA or palette images, which is what VICE writes.
function decodePng(buf) {
  let p = 8, w, h, depth, type, plte;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), t = buf.toString('ascii', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
    if (t === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; type = d[9]; }
    if (t === 'PLTE') plte = d;
    if (t === 'IDAT') idat.push(d);
    p += 12 + len;
  }
  if (depth !== 8) throw new Error('unsupported PNG bit depth ' + depth);
  const bpp = { 2: 3, 3: 1, 6: 4 }[type], raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp;
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0, b = y ? px[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y ? px[(y - 1) * stride + x - bpp] : 0;
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f];
      px[y * stride + x] = (line[x] + pred) & 255;
    }
  }
  const rgb = (x, y) => {
    const i = y * stride + x * bpp;
    return (type === 3 ? [plte[px[i] * 3], plte[px[i] * 3 + 1], plte[px[i] * 3 + 2]] : [px[i], px[i + 1], px[i + 2]]).join(',');
  };
  return { w, h, rgb };
}

// Compare a VICE screenshot with the expected RGBA screen (palette from APEXSCII) and border colour.
function compare(shot, rgba, border, palette) {
  const PAL = palette.map(h => h.toLowerCase());
  const want = Int8Array.from({ length: 64000 }, (_, i) =>
    PAL.indexOf('#' + [0, 1, 2].map(k => rgba[i * 4 + k].toString(16).padStart(2, '0')).join('')));
  const img = decodePng(fs.readFileSync(shot)), X0 = (img.w - 320) >> 1;
  const at = Y0 => {
    const pair = new Map(), back = new Map();
    let bad = 0, first = null;
    for (let y = 0; y < 200; y++) for (let x = 0; x < 320; x++) {
      const e = want[y * 320 + x], got = img.rgb(X0 + x, Y0 + y);
      if (!pair.has(e) && !back.has(got)) { pair.set(e, got); back.set(got, e); }
      if (pair.get(e) !== got) { bad++; first = first || `x${x} y${y} (cell ${x >> 3},${y >> 3})`; }
    }
    return { bad, first, back };
  };
  // PAL screenshots put the display 35 lines down; otherwise (NTSC) use the best-matching offset.
  let r = at(35);
  if (r.bad) for (let oy = 0; oy + 200 <= img.h; oy++) { const t = at(oy); if (t.bad < r.bad) r = t; }
  const b = img.rgb(4, 4), borderOk = !r.back.has(b) || r.back.get(b) === border;
  return { bad: r.bad, first: r.first, borderOk };
}

// Runs prg in VICE, stopping when `from` first executes, and returns the CPU cycles from there to the
// first time `to` executes (the monitor's stopwatch).
function cyclesBetween(exe, prg, from, to, { ntsc = false, model } = {}) {
  const hex = a => a.toString(16).padStart(4, '0');
  return new Promise((resolve, reject) => {
    const vice = spawn(exe, ['-default', '-warp', '-sounddev', 'dummy', '+confirmonexit', '-autostartprgmode', '1',
      ...machine({ ntsc, model }), '-initbreak', '0x' + hex(from),
      '-remotemonitor', '-remotemonitoraddress', `ip4://127.0.0.1:${PORT}`, '-autostart', prg], { stdio: 'ignore' });
    // The monitor takes one command per prompt: each step waits for `until` in the output, then sends.
    const steps = [
      { until: `(c:$${hex(from)})`, send: 'sw reset' },
      { until: 'stopwatch', send: 'delete' },
      { until: '', send: `break ${hex(to)}` },
      { until: 'break', send: 'x' },
      { until: `exec ${hex(to)})`, send: 'sw' },
    ];
    let out = '';
    const done = (err, v) => { clearTimeout(timer); vice.kill(); err ? reject(err) : resolve(v); };
    const timer = setTimeout(() => done(new Error('VICE never reached the breakpoints')), 120000);
    const connect = () => {
      const s = net.connect(PORT, '127.0.0.1');
      s.on('error', () => setTimeout(connect, 300));
      s.on('data', d => {
        out += d;
        if (!/\(C:\$[0-9a-f]{4}\) $/i.test(out)) return; // wait for the prompt
        const step = steps[0];
        if (step && out.toLowerCase().includes(step.until)) {
          steps.shift(); out = '';
          s.write(step.send + '\n');
        } else if (!step) {
          const m = out.match(/(\d+)\s*cycles/i) || out.match(/Stopwatch[^\d]*(\d+)/i);
          if (m) { s.write('quit\n'); setTimeout(() => done(null, +m[1]), 300); }
        }
      });
    };
    setTimeout(connect, 500);
  });
}

// Runs prg in VICE until `at` first executes, then returns the `len` bytes of memory from `addr`.
function readMemory(exe, prg, at, addr, len, { ntsc = false, model } = {}) {
  const hex = a => a.toString(16).padStart(4, '0');
  return new Promise((resolve, reject) => {
    const vice = spawn(exe, ['-default', '-warp', '-sounddev', 'dummy', '+confirmonexit', '-autostartprgmode', '1',
      ...machine({ ntsc, model }), '-initbreak', '0x' + hex(at),
      '-remotemonitor', '-remotemonitoraddress', `ip4://127.0.0.1:${PORT}`, '-autostart', prg], { stdio: 'ignore' });
    let out = '', sent = false;
    const done = (err, v) => { clearTimeout(timer); vice.kill(); err ? reject(err) : resolve(v); };
    const timer = setTimeout(() => done(new Error('VICE never reached the breakpoint')), 300000);
    const connect = () => {
      const s = net.connect(PORT, '127.0.0.1');
      s.on('error', () => setTimeout(connect, 300));
      s.on('data', d => {
        out += d;
        if (!/\(C:\$[0-9a-f]{4}\) $/i.test(out)) return;
        if (!sent) {
          if (!out.toLowerCase().includes(`(c:$${hex(at)})`)) return;
          sent = true; out = '';
          s.write(`m ${hex(addr)} ${hex(addr + len - 1)}\n`);
          return;
        }
        const bytes = [];
        for (const line of out.split('\n')) {
          const m = line.match(/^>C:([0-9a-f]{4})((?:\s+[0-9a-f]{2})+)/i);
          if (m) bytes.push(...m[2].trim().split(/\s+/).map(h => parseInt(h, 16)));
        }
        s.write('quit\n');
        setTimeout(() => done(null, bytes.slice(0, len)), 300);
      });
    };
    setTimeout(connect, 500);
  });
}

// A ld65 -Ln label file as { name: address }.
function labels(file) {
  return Object.fromEntries(fs.readFileSync(file, 'utf8').split('\n').map(l => l.trim().split(/\s+/))
    .filter(p => p.length === 3).map(([, a, n]) => [n.replace(/^\./, ''), parseInt(a, 16)]));
}

module.exports = { findVice, screenshot, decodePng, compare, cyclesBetween, readMemory, labels, machine, frameCycles };
