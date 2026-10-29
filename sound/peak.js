// The Mountain's sound (core/sound.js): an original, calm chiptune for the story demo, and its effects.
// D major, unhurried: a soft bass on the beat (voice 1, through a gentle low-pass), slow arpeggiated
// chords (voice 2, which the effects borrow on one SID), and a high, sparse melody (voice 3).
// D Bm G A.
//
// Patterns are 32 rows (two bars of sixteenths). Speed 6 makes a row 6 frames: 125 beats a minute,
// a 31-second loop. The effects are the text's: a letter typed, a page turned, a choice moved, a
// choice taken (stories/mountain.js sounds).
(function (root, song) {
  if (typeof module === 'object' && module.exports) module.exports = song;
  else (root.APEXSONGS = root.APEXSONGS || {}).peak = song;
})(typeof self !== 'undefined' ? self : this, {
  speed: 6,
  effectsVoice: 1,
  filter: { res: 6, mode: 'low', min: 0x280, max: 0x600, period: 192 },
  instruments: {
    bass: { wave: 'tri', ad: 0x08, sr: 0x6a, gate: 6, filter: true },
    maj: { wave: 'pulse', ad: 0x28, sr: 0x68, pw: 0x500, pwSpeed: 10, arp: [0, 4, 7, 12], gate: 10 },
    min: { wave: 'pulse', ad: 0x28, sr: 0x68, pw: 0x500, pwSpeed: 10, arp: [0, 3, 7, 12], gate: 10 },
    bell: { wave: 'tri', ad: 0x0a, sr: 0x0a, gate: 3 },
  },
  patterns: {
    b1: 'D-2:bass . . . . . . . D-2 . . . . . . . B-1 . . . . . . . B-1 . . . . . . .',
    b2: 'G-1:bass . . . . . . . G-1 . . . . . . . A-1 . . . . . . . A-1 . . . . . . .',
    c1: 'D-3:maj . . . . . . . . . . . . . . . B-2:min . . . . . . . . . . . . . . .',
    c2: 'G-2:maj . . . . . . . . . . . . . . . A-2:maj . . . . . . . . . . . . . . .',
    m1: 'F#5:bell . . . A-5 . . . . . . . E-5 . . . D-5 . . . . . . . F#5 . . . . . . .',
    m2: 'G-5:bell . . . B-5 . . . . . . . A-5 . . . E-5 . . . . . . . C#5 . . . . . . .',
    r1: '. . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .',
  },
  order: [
    ['b1', 'b2', 'b1', 'b2', 'b1', 'b2', 'b1', 'b2'],
    ['c1', 'c2', 'c1', 'c2', 'c1', 'c2', 'c1', 'c2'],
    ['r1', 'r1', 'm1', 'm2', 'm1', 'm2', 'r1', 'r1'],
  ],
  // in priority order, lowest first
  effects: {
    type: { priority: 0, steps: [
      { wave: 'noise', freq: 0x6000, ad: 0x00, sr: 0x00, ticks: 1 },
      { wave: 'noise', gate: false, freq: 0x6000, ad: 0x00, sr: 0x00, ticks: 1 },
    ] },
    move: { priority: 1, steps: [
      { wave: 'pulse', freq: 0x2800, ad: 0x00, sr: 0x40, pw: 0x800, ticks: 2 },
      { wave: 'pulse', gate: false, freq: 0x2800, ad: 0x00, sr: 0x40, pw: 0x800, ticks: 1 },
    ] },
    more: { priority: 2, steps: [
      { wave: 'tri', freq: 0x3000, ad: 0x00, sr: 0x66, ticks: 3 },
      { wave: 'tri', freq: 0x4000, ad: 0x00, sr: 0x66, ticks: 4 },
      { wave: 'tri', gate: false, freq: 0x4000, ad: 0x00, sr: 0x66, ticks: 1 },
    ] },
    choose: { priority: 3, steps: [
      { wave: 'pulse', freq: 0x2400, ad: 0x00, sr: 0x88, pw: 0x800, ticks: 4 },
      { wave: 'pulse', freq: 0x3600, ad: 0x00, sr: 0x88, pw: 0x800, ticks: 4 },
      { wave: 'pulse', freq: 0x4800, ad: 0x00, sr: 0x88, pw: 0x800, ticks: 8 },
      { wave: 'pulse', gate: false, freq: 0x4800, ad: 0x00, sr: 0x88, pw: 0x800, ticks: 1 },
    ] },
  },
  EVENTS: { type: ['type'], more: ['more'], move: ['move'], choose: ['choose'] },
});
