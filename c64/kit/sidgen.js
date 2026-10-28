// APEX C64 kit: a song and its effects (core/sound.js compile()) as tables for the SID driver
// (c64/kit/sid.inc), written as sound.inc (ca65 source) into a build folder.
//
//   sidgen(compiled, dir)   writes dir/sound.inc; returns the effects' ids by name (SFX_<NAME> are
//                           also defined in sound.inc)
const fs = require('fs'), path = require('path');
const S = require('../../core/sound.js');

function sidgen(c, dir) {
  const out = [], b = v => v & 255;
  const table = (name, values) => out.push(`${name}: .byte ${values.length ? values.map(b).join(',') : '0'}`);
  if (c.ins.length > 32 || c.patterns.length > 64 || c.effects.length > 32) throw new Error('too many instruments, patterns or effects');
  out.push(`SND_SPEED = ${c.speed}`, `SND_ORDER_LEN = ${c.order[0].length}`, `SND_EFFECTS = ${c.effects.length}`,
    `SFX_VOICE = ${c.effectsVoice}`, `SFX_BASE = ${7 * c.effectsVoice}`,
    `SND_RES = ${c.filter.res}`, `SND_FMODE = ${c.filter.mode}`, `SND_FPERIOD = ${c.filter.cut.length}`);
  c.effNames.forEach((n, i) => out.push(`SFX_${n.replace(/[A-Z]/g, m => '_' + m).toUpperCase()} = ${i}`));
  out.push('.segment "RODATA"');
  table('SND_FREQ_LO', S.FREQ.map(f => f & 255));
  table('SND_FREQ_HI', S.FREQ.map(f => f >> 8));
  // instruments, and their arpeggios one after another
  const arp = [], arpAt = [];
  for (const i of c.ins) { arpAt.push(arp.length); arp.push(...i.arp); }
  if (arp.length > 256) throw new Error('arpeggios too long');
  table('SND_ARP', arp);
  table('INS_ARP', arpAt);
  table('INS_ARPLEN', c.ins.map(i => i.arp.length));
  table('INS_WAVE', c.ins.map(i => i.wave));
  table('INS_AD', c.ins.map(i => i.ad));
  table('INS_SR', c.ins.map(i => i.sr));
  table('INS_PWL', c.ins.map(i => i.pw & 255));
  table('INS_PWH', c.ins.map(i => i.pw >> 8));
  table('INS_PWSL', c.ins.map(i => i.pwSpeed & 255));
  table('INS_PWSH', c.ins.map(i => (i.pwSpeed >> 8) & 255));
  table('INS_GATE', c.ins.map(i => i.gate));
  table('INS_FILT', c.ins.map(i => (i.filter ? 1 : 0)));
  // instruments' tables, one after another: per step its waveform and note (a fixed note + $80, or
  // + n as 7 bits)
  const tw = [], tn = [], tabAt = [];
  for (const i of c.ins) { tabAt.push(tw.length); for (const [w, n] of i.table) { tw.push(w); tn.push(n); } }
  if (tw.length > 255) throw new Error('instrument tables too long');
  table('INS_TAB', tabAt);
  table('INS_TLEN', c.ins.map(i => i.table.length));
  table('SND_TW', tw);
  table('SND_TN', tn);
  // the filter's cutoff, tick by tick
  table('SND_CUT_LO', c.filter.cut.map(v => v & 7));
  table('SND_CUT_HI', c.filter.cut.map(v => v >> 3));
  // patterns: 32 rows of two bytes: the op (0 nothing, 1 release, 2 + note) and the instrument ($ff:
  // the voice's last)
  c.patterns.forEach((rows, k) => table(`SND_PAT_${k}`, rows.flatMap(r => [r.op === 2 ? 2 + r.note : r.op, r.op === 2 && r.ins >= 0 ? r.ins : 0xff])));
  out.push(`SND_PAT_LO: .lobytes ${c.patterns.map((_, k) => `SND_PAT_${k}`).join(',')}`);
  out.push(`SND_PAT_HI: .hibytes ${c.patterns.map((_, k) => `SND_PAT_${k}`).join(',')}`);
  // the order: per position, the three voices' patterns
  table('SND_ORDER', c.order[0].flatMap((_, i) => [c.order[0][i], c.order[1][i], c.order[2][i]]));
  // effects: their priority and steps (the first, and one past the last, in the step tables)
  const steps = c.effects.flatMap(e => e.steps);
  if (steps.length > 255) throw new Error('too many effect steps');
  let at = 0;
  const first = c.effects.map(e => { const f = at; at += e.steps.length; return f; });
  table('SFX_PRI', c.effects.map(e => e.priority));
  table('SFX_FIRST', first);
  table('SFX_END', c.effects.map((e, i) => first[i] + e.steps.length));
  table('ST_CTRL', steps.map(s => s.ctrl));
  table('ST_FL', steps.map(s => s.freq & 255));
  table('ST_FH', steps.map(s => s.freq >> 8));
  table('ST_SL', steps.map(s => s.slide & 255));
  table('ST_SH', steps.map(s => (s.slide >> 8) & 255));
  table('ST_AD', steps.map(s => s.ad));
  table('ST_SR', steps.map(s => s.sr));
  table('ST_PWL', steps.map(s => s.pw & 255));
  table('ST_PWH', steps.map(s => s.pw >> 8));
  table('ST_TICKS', steps.map(s => s.ticks));
  out.push('.segment "CODE"');
  fs.writeFileSync(path.join(dir, 'sound.inc'), out.join('\n') + '\n');
  return Object.fromEntries(c.effNames.map((n, i) => [n, i]));
}

module.exports = { sidgen };
