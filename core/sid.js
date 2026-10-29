/*
 * APEX SID: an emulation of the C64's sound chip, for hearing the games outside a C64 (the browser
 * pages, WAV files). It plays the register image core/sound.js makes each frame (all 25 registers,
 * written at once), so the music and effects sound as the C64's SID makes them, closely though not
 * exactly (the C64 tests check the registers, not the sound):
 *
 *   - three voices, each a 24-bit phase accumulator adding its frequency every cycle (985248 a second,
 *     PAL), giving a triangle, sawtooth, pulse (against the 12-bit pulse width) or noise (a 23-bit
 *     shift register clocked by bit 19), and combinations of them as the bitwise AND (roughly); sync
 *     and ring modulation from the voice before, the test bit
 *   - an envelope per voice: attack, decay to the sustain level, release, at the SID's rates, decay and
 *     release slowing as the level falls (its piecewise exponential), its rate counter never reset
 *     (so the ADSR bug happens as on the chip); the gate starts and releases it
 *   - the filter: a resonant state-variable filter (low, band and high pass, mixed by the mode bits)
 *     over the voices routed to it, its cutoff following the 6581's curve; voice 3 can be cut from the
 *     output; the master volume
 *
 * create(sampleRate) makes a chip; write(R) sets its 25 registers; render(out, at, n) adds n samples
 * (-1..1) into out from at. Works in Node, in the browser (global APEXSID), and inside an
 * AudioWorklet (APEXSID.source is this file's factory as text, to build one from).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.APEXSID = Object.assign(factory(), { source: '(' + factory.toString() + ')()' });
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CLOCK = 985248;
  // Cycles per envelope step for rates 0-15 (attack; decay and release use the same, slowed below).
  const RATE = [9, 32, 63, 95, 149, 220, 267, 313, 392, 977, 1954, 3126, 3907, 11720, 19532, 31251];
  // Decay and release take 1, 2, 4, 8, 16 or 30 steps of the rate per level step as the level falls.
  const slowdown = l => (l >= 0x5d ? 1 : l >= 0x36 ? 2 : l >= 0x1a ? 4 : l >= 0x0e ? 8 : l >= 0x06 ? 16 : 30);
  const ATTACK = 0, DECAY = 1, RELEASE = 2;
  // The output's scale: as loud as VICE's recordings of the same (test/sid-compare.js).
  const LEVEL = 0.095;
  // The 6581's filter cutoff in Hz for the 11-bit cutoff register, every $100 (roughly, as measured
  // chips go): low and flat at first, then rising steeply. Between the points it is interpolated on a
  // log scale.
  const CUTOFF = [220, 230, 300, 520, 1000, 2200, 4500, 8000, 12000];
  const cutoffHz = fc => {
    const i = Math.min(7, fc >> 8), t = (fc & 255) / 256;
    return CUTOFF[i] * (CUTOFF[i + 1] / CUTOFF[i]) ** t;
  };

  function create(sampleRate) {
    const cps = CLOCK / sampleRate; // cycles a sample
    const voices = [0, 1, 2].map(() => ({
      acc: 0, freq: 0, pw: 0, ctrl: 0, ad: 0, sr: 0, noise: 0x7ffff8, gate: false,
      env: 0, state: RELEASE, rc: 0, ec: 0, frac: 0,
    }));
    let cutoff = 0, res = 0, route = 0, mode = 0, volume = 0, voice3off = false;
    let low = 0, band = 0; // the filter's state

    function write(R) {
      voices.forEach((v, k) => {
        const b = 7 * k;
        v.freq = R[b] | (R[b + 1] << 8);
        v.pw = (R[b + 2] | (R[b + 3] << 8)) & 0x0fff;
        const ctrl = R[b + 4], gate = !!(ctrl & 1);
        if (gate && !v.gate) { v.state = ATTACK; v.ec = 0; }
        if (!gate && v.gate) v.state = RELEASE;
        v.gate = gate;
        if (ctrl & 8) { v.acc = 0; v.noise = 0x7ffff8; } // the test bit: the oscillator held at 0
        v.ctrl = ctrl;
        v.ad = R[b + 5]; v.sr = R[b + 6];
      });
      cutoff = (R[21] & 7) | (R[22] << 3);
      res = R[23] >> 4; route = R[23] & 7;
      mode = R[24] & 0x70; volume = R[24] & 15; voice3off = !!(R[24] & 0x80);
    }

    // A voice's envelope moves on by `cycles`. As on the chip: a 15-bit rate counter counts cycles up
    // to the rate's period and steps the envelope there; it is never reset, so a period shorter than
    // the count so far waits for the counter to come round (up to 32768 cycles: the ADSR bug, which
    // the driver's hard restart avoids). Decay and release step only every slowdown(level) of those.
    function envelope(v, cycles) {
      v.frac += cycles;
      let c = Math.floor(v.frac);
      v.frac -= c;
      while (c > 0) {
        const p = RATE[v.state === ATTACK ? v.ad >> 4 : v.state === DECAY ? v.ad & 15 : v.sr & 15];
        const need = v.rc < p ? p - v.rc : 0x8000 - v.rc + p;
        if (c < need) { v.rc = (v.rc + c) & 0x7fff; return; }
        c -= need;
        v.rc = 0;
        if (v.state === ATTACK) {
          if (++v.env >= 0xff) { v.env = 0xff; v.state = DECAY; v.ec = 0; }
        } else if (!(v.state === DECAY && v.env <= (v.sr >> 4) * 17) && v.env > 0 && ++v.ec >= slowdown(v.env)) {
          v.ec = 0;
          v.env--;
        }
      }
    }

    // A voice's waveform, 12 bits, from its accumulator (and the voice before's, for ring modulation).
    function wave(v, before) {
      const c = v.ctrl, a = Math.floor(v.acc);
      let out = 0xfff, any = false;
      const and = w => { out &= w; any = true; };
      if (c & 0x10) { // triangle: the top bit folds the ramp (or the voice before's, ring modulated)
        const fold = (c & 4 ? (a ^ Math.floor(before.acc)) : a) & 0x800000;
        and(((fold ? ~a : a) >> 11) & 0xfff);
      }
      if (c & 0x20) and(a >> 12);
      if (c & 0x40) and((a >> 12) >= v.pw ? 0xfff : 0);
      if (c & 0x80) { // noise: 8 bits of the shift register
        const n = v.noise;
        and((((n >> 20) & 1) << 11) | (((n >> 18) & 1) << 10) | (((n >> 14) & 1) << 9) | (((n >> 11) & 1) << 8) |
          (((n >> 9) & 1) << 7) | (((n >> 5) & 1) << 6) | (((n >> 2) & 1) << 5) | ((n & 1) << 4));
      }
      return any ? out : 0x800;
    }

    function render(out, at, n) {
      // the filter's coefficients for this stretch
      const fc = cutoffHz(cutoff), f = 2 * Math.sin(Math.PI * Math.min(fc, sampleRate / 4) / sampleRate);
      const q = 1.0 / (0.707 + res / 15 * 2.2);
      for (let s = 0; s < n; s++) {
        let direct = 0, filtered = 0;
        for (let k = 0; k < 3; k++) {
          const v = voices[k], before = voices[(k + 2) % 3];
          if (!(v.ctrl & 8)) {
            const step = v.freq * cps, old = v.acc, next = old + step;
            // noise: its shift register clocks each time bit 19 of the accumulator goes up
            if (v.ctrl & 0x80) for (let t = Math.floor(next / 0x100000) - Math.floor(old / 0x100000); t > 0; t--) {
              const bit = ((v.noise >> 22) ^ (v.noise >> 17)) & 1;
              v.noise = ((v.noise << 1) | bit) & 0x7fffff;
            }
            v.acc = next % 0x1000000;
            // hard sync: the next voice restarts when this one's top bit rises
            const after = voices[(k + 1) % 3];
            if ((after.ctrl & 2) && Math.floor((next + 0x800000) / 0x1000000) > Math.floor((old + 0x800000) / 0x1000000)) after.acc = 0;
          }
          envelope(v, cps);
          const o = ((wave(v, before) - 0x800) * v.env) / (0x800 * 0xff);
          if (route & (1 << k)) filtered += o;
          else if (!(k === 2 && voice3off)) direct += o;
        }
        // the state-variable filter, in two half steps a sample for stability
        let hp = 0;
        for (let r = 0; r < 2; r++) {
          hp = filtered - low - q * band;
          band += (f / 2) * hp;
          low += (f / 2) * band;
        }
        const f2 = (mode & 0x10 ? low : 0) + (mode & 0x20 ? band : 0) + (mode & 0x40 ? hp : 0);
        out[at + s] += ((direct + f2) * volume) / 15 * LEVEL;
      }
    }

    return { write, render };
  }

  return { CLOCK, create };
});
