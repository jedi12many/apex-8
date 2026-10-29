/*
 * APEX sound: the reference for SID music and sound effects. Integer maths only, so a 6502 driver
 * that follows the same steps writes exactly the same SID registers every frame.
 *
 *   - one tick per frame; each tick sets all 25 SID registers (the register image)
 *   - music: 3 voices, each playing patterns of 32 rows in its own order list (all the same length;
 *     the song loops); a row lasts `speed` ticks. A row on a voice is a note (with its instrument, or
 *     the voice's last), a release, or nothing (the note goes on)
 *   - instruments: a waveform, ADSR, a pulse width that sweeps, an arpeggio (semitones added tick by
 *     tick, round and round) and a gate length (ticks until release; 0 holds it). Or, for drums, a
 *     table: per tick of the note a waveform and a note (the played note + n, or a fixed note), the
 *     last held. An instrument can go through the filter
 *   - a new note restarts hard: one tick with the gate off, then on (a table starts once it's on)
 *   - the filter: one for the song, a resonant low-pass (or band or high) whose cutoff sweeps up and
 *     down, over the voices playing instruments that use it
 *   - sound effects play on one voice (the song's effectsVoice, voice 3 unless it says) instead of
 *     the music, which goes on underneath. An effect is steps, each a waveform (with its gate bit), a
 *     frequency that slides, ADSR, a pulse width and a length in ticks. A new effect starts if none
 *     is playing or its priority is at least the one's playing
 *
 * compile(def) turns a song and its effects (see sound/shmup.js) into tables; player(c) makes a
 * player; tick(c, p, effects) plays one tick, starting the effects listed (in order), and returns
 * the register image. checksum(sum, image) folds an image into a running 16-bit checksum, which
 * the C64 tests compare.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.APEXSOUND = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ROWS = 32;
  const WAVE = { tri: 0x10, saw: 0x20, pulse: 0x40, noise: 0x80 };
  const PAL_CLOCK = 985248;
  // SID frequency values for notes 0-95 (C-0 to B-7), A-4 (57) at 440 Hz on a PAL machine.
  const FREQ = Array.from({ length: 96 }, (_, n) => Math.min(0xffff, Math.round((440 * 2 ** ((n - 57) / 12) * 16777216) / PAL_CLOCK)));
  const NAMES = ['C-', 'C#', 'D-', 'D#', 'E-', 'F-', 'F#', 'G-', 'G#', 'A-', 'A#', 'B-'];
  const noteOf = s => {
    const i = NAMES.indexOf(s.slice(0, 2)), oct = +s[2];
    if (i < 0 || !(oct >= 0 && oct <= 7)) throw new Error(`not a note: ${s}`);
    return oct * 12 + i;
  };
  // Row tokens in the tables: 0 nothing, 1 release, 2 + note (with the instrument in the next byte).
  const NOTHING = 0, RELEASE = 1;
  const FILTER_MODE = { low: 0x10, band: 0x20, high: 0x40 };

  // def: { speed, instruments: { name: { wave, ad, sr, pw, pwSpeed, arp, gate } }, patterns: { name:
  // 'C-3:inst . . == ...' (32 tokens) }, order: [[names] x 3], effects: { name: { priority, steps:
  // [{ wave, gate, freq, slide, ad, sr, pw, ticks }] } } }
  function compile(def) {
    const insNames = Object.keys(def.instruments), ins = insNames.map(n => {
      const i = def.instruments[n];
      // a table step: [wave, note], the note + n or a fixed note ('C-3'): as tw (the waveform) and tn
      // (a fixed note + $80, or n as a signed byte)
      const table = (i.table || []).map(([w, n]) => [WAVE[w], typeof n === 'string' ? 0x80 | noteOf(n) : n & 0x7f]);
      return { wave: WAVE[i.wave || 'pulse'], ad: i.ad, sr: i.sr, pw: i.pw || 0, pwSpeed: i.pwSpeed || 0, arp: i.arp && i.arp.length ? i.arp : [0], gate: i.gate || 0, table, filter: !!i.filter };
    });
    const patNames = Object.keys(def.patterns), patterns = patNames.map(n => {
      const toks = def.patterns[n].trim().split(/\s+/);
      if (toks.length !== ROWS) throw new Error(`pattern ${n}: ${toks.length} rows, not ${ROWS}`);
      return toks.map(t => {
        if (t === '.') return { op: NOTHING };
        if (t === '==') return { op: RELEASE };
        const [note, insName] = t.split(':');
        const k = insName === undefined ? -1 : insNames.indexOf(insName);
        if (insName !== undefined && k < 0) throw new Error(`pattern ${n}: no instrument ${insName}`);
        return { op: 2, note: noteOf(note), ins: k };
      });
    });
    const order = def.order.map(list => list.map(n => {
      const k = patNames.indexOf(n);
      if (k < 0) throw new Error(`no pattern ${n}`);
      return k;
    }));
    if (order.length !== 3 || order.some(l => l.length !== order[0].length)) throw new Error('3 order lists of one length');
    const effNames = Object.keys(def.effects || {}), effects = effNames.map(n => {
      const e = def.effects[n];
      return { priority: e.priority, steps: e.steps.map(s => ({ ctrl: WAVE[s.wave] | (s.gate === false ? 0 : 1), freq: s.freq & 0xffff, slide: s.slide || 0, ad: s.ad, sr: s.sr, pw: s.pw || 0, ticks: s.ticks })) };
    });
    // the filter's cutoff (11 bits) tick by tick: a triangle from min to max and back over period ticks
    const f = def.filter || { res: 0, min: 0, max: 0, period: 2 };
    if (f.period < 2 || f.period > 256 || f.period & 1) throw new Error('filter period: an even number of ticks up to 256');
    const half = f.period / 2, cut = Array.from({ length: f.period }, (_, k) => f.min + Math.floor(((f.max - f.min) * (k < half ? k : f.period - k)) / half));
    const filter = { res: f.res, mode: FILTER_MODE[f.mode] || 0, cut };
    const effectsVoice = def.effectsVoice === undefined ? 2 : def.effectsVoice;
    return { speed: def.speed, ins, insNames, patterns, patNames, order, effects, effNames, filter, effectsVoice };
  }

  function player(c) {
    return {
      timer: 0, row: 0, pos: 0,
      voices: [0, 1, 2].map(() => ({ ins: -1, note: 0, phase: 2, age: 0, arp: 0, pw: 0, tpos: 0 })),
      sfx: -1, step: 0, left: 0, freq: 0, ft: 0,
    };
  }

  function startEffect(c, p, id) {
    if (p.sfx >= 0 && c.effects[id].priority < c.effects[p.sfx].priority) return;
    p.sfx = id; p.step = 0;
    const s = c.effects[id].steps[0];
    p.left = s.ticks; p.freq = s.freq;
  }

  function tick(c, p, effects = []) {
    for (const id of effects) startEffect(c, p, id);
    // a new row on every voice
    if (p.timer === 0) {
      for (let v = 0; v < 3; v++) {
        const r = c.patterns[c.order[v][p.pos]][p.row], vs = p.voices[v];
        if (r.op === RELEASE) vs.phase = 2;
        else if (r.op >= 2) {
          if (r.ins >= 0) vs.ins = r.ins;
          if (vs.ins >= 0) Object.assign(vs, { note: r.note, phase: 0, age: 0, arp: 0, tpos: 0, pw: c.ins[vs.ins].pw });
        }
      }
      if (++p.row === ROWS) { p.row = 0; if (++p.pos === c.order[0].length) p.pos = 0; }
      p.timer = c.speed;
    }
    p.timer--;
    // each voice's registers, then its state moves on
    const R = new Uint8Array(25), ev = c.effectsVoice;
    let route = 0;
    for (let v = 0; v < 3; v++) {
      const vs = p.voices[v], b = 7 * v;
      if (vs.ins < 0) continue;
      const ins = c.ins[vs.ins];
      let wave = ins.wave, note = vs.note + ins.arp[vs.arp];
      if (ins.table.length) {
        const [tw, tn] = ins.table[Math.min(vs.tpos, ins.table.length - 1)];
        wave = tw;
        note = tn & 0x80 ? tn & 0x7f : vs.note + ((tn ^ 0x40) - 0x40); // (a fixed note, or + n)
      }
      const f = FREQ[Math.max(0, Math.min(95, note))];
      if (!(v === ev && p.sfx >= 0)) {
        R[b] = f & 255; R[b + 1] = f >> 8;
        R[b + 2] = vs.pw & 255; R[b + 3] = vs.pw >> 8;
        R[b + 4] = wave | (vs.phase === 1 ? 1 : 0);
        R[b + 5] = ins.ad; R[b + 6] = ins.sr;
        if (ins.filter) route |= 1 << v;
      }
      if (vs.phase !== 0 && vs.tpos < 255) vs.tpos++;
      if (vs.phase === 0) vs.phase = 1;
      else if (vs.phase === 1 && ins.gate && vs.age + 1 >= ins.gate) vs.phase = 2;
      if (vs.age < 255) vs.age++;
      if (++vs.arp === ins.arp.length) vs.arp = 0;
      vs.pw = (vs.pw + ins.pwSpeed) & 0x0fff;
    }
    // an effect on its voice
    if (p.sfx >= 0) {
      const e = c.effects[p.sfx], s = e.steps[p.step], b = 7 * ev;
      R[b] = p.freq & 255; R[b + 1] = p.freq >> 8;
      R[b + 2] = s.pw & 255; R[b + 3] = s.pw >> 8;
      R[b + 4] = s.ctrl; R[b + 5] = s.ad; R[b + 6] = s.sr;
      p.freq = (p.freq + s.slide) & 0xffff;
      if (--p.left === 0) {
        if (++p.step === e.steps.length) p.sfx = -1;
        else { const n = e.steps[p.step]; p.left = n.ticks; p.freq = n.freq; }
      }
    }
    // the filter, and the volume
    const cut = c.filter.cut[p.ft];
    if (++p.ft === c.filter.cut.length) p.ft = 0;
    R[21] = cut & 7; R[22] = cut >> 3;
    R[23] = (c.filter.res << 4) | route;
    R[24] = c.filter.mode | 0x0f;
    return R;
  }

  const checksum = (sum, R) => {
    for (const b of R) sum = ((((sum << 1) | (sum >> 15)) & 0xffff) + b) & 0xffff;
    return sum;
  };

  return { ROWS, WAVE, FREQ, NOTHING, RELEASE, noteOf, compile, player, tick, checksum };
});
