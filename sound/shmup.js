// The Dreadnought's sound (core/sound.js): a driving loop in A minor, and the shoot-'em-up's effects.
// Patterns are 32 rows: a note (with :instrument to change it), . (nothing: the note goes on) or ==
// (release). Speed 6 makes a row 6 frames: 125 beats a minute in sixteenths, a 31-second loop.
module.exports = {
  speed: 6,
  instruments: {
    bass: { wave: 'saw', ad: 0x08, sr: 0x00, gate: 3 },
    lead: { wave: 'pulse', ad: 0x0a, sr: 0xa6, pw: 0x400, pwSpeed: 24, gate: 18 },
    minor: { wave: 'pulse', ad: 0x08, sr: 0x60, pw: 0x600, pwSpeed: 32, arp: [0, 3, 7] },
    major: { wave: 'pulse', ad: 0x08, sr: 0x60, pw: 0x600, pwSpeed: 32, arp: [0, 4, 7] },
  },
  patterns: {
    sil: '. . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .',
    b1: 'A-1:bass . A-2 . A-1 . A-2 . A-1 . A-2 . A-1 . A-2 . F-1 . F-2 . F-1 . F-2 . F-1 . F-2 . F-1 . F-2 .',
    b2: 'G-1 . G-2 . G-1 . G-2 . G-1 . G-2 . G-1 . G-2 . E-1 . E-2 . E-1 . E-2 . E-1 . E-2 . E-1 . E-2 .',
    l1: 'E-4:lead . . . A-4 . . . C-5 . B-4 . A-4 . . . F-4 . . . A-4 . . . C-5 . . . A-4 . . .',
    l2: 'G-4 . . . B-4 . . . D-5 . C-5 . B-4 . . . G#4 . . . B-4 . . . E-5 . . . == . . .',
    l3: 'D-5 . . . C-5 . . . B-4 . . . G-4 . . . G#4 . B-4 . E-5 . . . . . . . == . . .',
    a1: 'A-3:minor . . . . . . . . . . . . . . . F-3:major . . . . . . . . . . . . . . .',
    a2: 'G-3:major . . . . . . . . . . . . . . . E-3:major . . . . . . . . . . . . . . .',
  },
  order: [
    ['b1', 'b2', 'b1', 'b2', 'b1', 'b2', 'b1', 'b2'],
    ['sil', 'sil', 'l1', 'l2', 'l1', 'l3', 'l1', 'l2'],
    ['a1', 'a2', 'a1', 'a2', 'a1', 'a2', 'a1', 'a2'],
  ],
  // in priority order, lowest first
  effects: {
    shot: { priority: 0, steps: [
      { wave: 'pulse', freq: 0x3000, slide: -0x300, ad: 0x00, sr: 0xa0, pw: 0x800, ticks: 5 },
      { wave: 'pulse', gate: false, freq: 0x1800, ad: 0x00, sr: 0xa0, pw: 0x800, ticks: 1 },
    ] },
    enemyFire: { priority: 1, steps: [
      { wave: 'tri', freq: 0x0c00, slide: 0x100, ad: 0x00, sr: 0xf0, ticks: 6 },
      { wave: 'tri', gate: false, freq: 0x1200, ad: 0x00, sr: 0xf0, ticks: 1 },
    ] },
    hit: { priority: 2, steps: [
      { wave: 'noise', freq: 0x4000, ad: 0x00, sr: 0xf0, ticks: 2 },
      { wave: 'pulse', freq: 0x0800, ad: 0x00, sr: 0xf0, pw: 0x400, ticks: 2 },
      { wave: 'pulse', gate: false, freq: 0x0800, ad: 0x00, sr: 0xf0, pw: 0x400, ticks: 1 },
    ] },
    explode: { priority: 3, steps: [
      { wave: 'noise', freq: 0x1400, slide: -0x60, ad: 0x00, sr: 0xf9, ticks: 14 },
      { wave: 'noise', gate: false, freq: 0x0900, slide: -0x20, ad: 0x00, sr: 0xf9, ticks: 10 },
    ] },
    death: { priority: 4, steps: [
      { wave: 'noise', freq: 0x2000, slide: -0x50, ad: 0x00, sr: 0xfa, ticks: 40 },
      { wave: 'noise', gate: false, freq: 0x0400, ad: 0x00, sr: 0xfa, ticks: 30 },
    ] },
  },
};
