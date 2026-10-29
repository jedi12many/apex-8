// Green Hills' sound (core/sound.js): an original, upbeat chiptune for the platformer, and its effects.
// C major at 150 beats a minute: an octave-jumping bass on the sixteenths (voice 1, through a bright
// low-pass), arpeggiated chords on the offbeats (voice 2, which the effects borrow on one SID), and a
// bouncy melody over kick, snare and hats (voice 3, sharing it with the drums as the tune rests).
// C Am F G.
//
// Patterns are 32 rows (two bars of sixteenths). Speed 5 makes a row 5 frames: 150 beats a minute, a
// 25-second loop. EVENTS says which effects each of the game's events (core/platform.js) starts.
(function (root, song) {
  if (typeof module === 'object' && module.exports) module.exports = song;
  else (root.APEXSONGS = root.APEXSONGS || {}).hills = song;
})(typeof self !== 'undefined' ? self : this, {
  speed: 5,
  effectsVoice: 1,
  filter: { res: 8, mode: 'low', min: 0x300, max: 0x700, period: 160 },
  instruments: {
    bass: { wave: 'pulse', ad: 0x08, sr: 0x48, pw: 0x400, gate: 2, filter: true },
    maj: { wave: 'pulse', ad: 0x06, sr: 0x46, pw: 0x600, pwSpeed: 32, arp: [0, 4, 7], gate: 2 },
    min: { wave: 'pulse', ad: 0x06, sr: 0x46, pw: 0x600, pwSpeed: 32, arp: [0, 3, 7], gate: 2 },
    lead: { wave: 'pulse', ad: 0x09, sr: 0x89, pw: 0x200, pwSpeed: 24, gate: 4 },
    kick: { ad: 0x00, sr: 0xf6, pw: 0x800, gate: 5,
      table: [['pulse', 'E-3'], ['pulse', 'C-3'], ['tri', 'G-2'], ['tri', 'E-2'], ['tri', 'C-2']] },
    snare: { ad: 0x00, sr: 0xf7, pw: 0x800, gate: 6, table: [['noise', 'C-6'], ['pulse', 'C-3'], ['noise', 'A-5'], ['noise', 'G-5']] },
    hat: { ad: 0x01, sr: 0x00, gate: 1, table: [['noise', 'C-7']] },
  },
  patterns: {
    // the bass: root and octave on the sixteenths
    b1: 'C-2:bass . C-3 . C-2 . C-3 . C-2 . C-3 . C-2 . C-3 . A-1 . A-2 . A-1 . A-2 . A-1 . A-2 . A-1 . A-2 .',
    b2: 'F-1:bass . F-2 . F-1 . F-2 . F-1 . F-2 . F-1 . F-2 . G-1 . G-2 . G-1 . G-2 . G-1 . G-2 . B-1 . G-2 .',
    // the chords, on the offbeats
    c1: '. . C-4:maj . . . C-4 . . . C-4 . . . C-4 . . . A-3:min . . . A-3 . . . A-3 . . . A-3 .',
    c2: '. . F-3:maj . . . F-3 . . . F-3 . . . F-3 . . . G-3:maj . . . G-3 . . . G-3 . . . G-3 .',
    // the melody
    m1: 'E-5:lead . G-5 . C-6 . . . B-5 . A-5 . G-5 . . . A-5 . . . C-6 . . . A-5 . G-5 . E-5 . . .',
    m2: 'F-5:lead . A-5 . C-6 . . . A-5 . G-5 . F-5 . . . G-5 . . . B-5 . . . D-6 . . . B-5 . . .',
    // the drums, under the melody's rests: kick on the beat, snare on 2 and 4, hats between
    d1: 'C-1:kick . C-1:hat . C-1:snare . C-1:hat . C-1:kick . C-1:hat . C-1:snare . C-1:hat . C-1:kick . C-1:hat . C-1:snare . C-1:hat . C-1:kick . C-1:hat . C-1:snare . C-1:snare .',
  },
  order: [
    ['b1', 'b2', 'b1', 'b2', 'b1', 'b2', 'b1', 'b2'],
    ['c1', 'c2', 'c1', 'c2', 'c1', 'c2', 'c1', 'c2'],
    ['d1', 'd1', 'm1', 'm2', 'm1', 'm2', 'd1', 'd1'],
  ],
  // in priority order, lowest first
  effects: {
    jump: { priority: 0, steps: [
      { wave: 'pulse', freq: 0x0c00, slide: 0x180, ad: 0x00, sr: 0x40, pw: 0x400, ticks: 6 },
      { wave: 'pulse', gate: false, freq: 0x1500, ad: 0x00, sr: 0x40, pw: 0x400, ticks: 1 },
    ] },
    coin: { priority: 1, steps: [
      { wave: 'pulse', freq: 0x3e00, ad: 0x00, sr: 0x86, pw: 0x800, ticks: 4 },
      { wave: 'pulse', freq: 0x5300, ad: 0x00, sr: 0x86, pw: 0x800, ticks: 10 },
      { wave: 'pulse', gate: false, freq: 0x5300, ad: 0x00, sr: 0x86, pw: 0x800, ticks: 1 },
    ] },
    stomp: { priority: 2, steps: [
      { wave: 'noise', freq: 0x1800, ad: 0x00, sr: 0xa0, ticks: 2 },
      { wave: 'tri', freq: 0x1000, slide: -0x180, ad: 0x00, sr: 0xa0, ticks: 6 },
      { wave: 'tri', gate: false, freq: 0x0800, ad: 0x00, sr: 0xa0, ticks: 1 },
    ] },
    hurt: { priority: 3, steps: [
      { wave: 'saw', freq: 0x1800, slide: -0x80, ad: 0x00, sr: 0xc8, ticks: 20 },
      { wave: 'saw', gate: false, freq: 0x0e00, ad: 0x00, sr: 0xc8, ticks: 6 },
    ] },
    fall: { priority: 4, steps: [
      { wave: 'tri', freq: 0x2400, slide: -0x60, ad: 0x00, sr: 0xc9, ticks: 40 },
      { wave: 'tri', gate: false, freq: 0x0a00, ad: 0x00, sr: 0xc9, ticks: 6 },
    ] },
    win: { priority: 5, steps: [
      { wave: 'pulse', freq: 0x1d50, ad: 0x00, sr: 0xa8, pw: 0x800, ticks: 8 },
      { wave: 'pulse', freq: 0x24a0, ad: 0x00, sr: 0xa8, pw: 0x800, ticks: 8 },
      { wave: 'pulse', freq: 0x2bc0, ad: 0x00, sr: 0xa8, pw: 0x800, ticks: 8 },
      { wave: 'pulse', freq: 0x3aa0, ad: 0x00, sr: 0xaa, pw: 0x800, ticks: 36 },
      { wave: 'pulse', gate: false, freq: 0x3aa0, ad: 0x00, sr: 0xaa, pw: 0x800, ticks: 1 },
    ] },
  },
  EVENTS: { jump: ['jump'], coin: ['coin'], stomp: ['stomp'], hurt: ['hurt'], fall: ['fall'], win: ['win'] },
});
