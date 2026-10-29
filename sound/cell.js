// The Cell Block's sound (core/sound.js): an original, brooding chiptune for the raycaster, and its
// effects. A minor, slow: a pulsing low drone (voice 1, through a dark low-pass that slowly opens and
// closes), a heartbeat kick and a distant ticking hat (voice 2, which the effects borrow on one SID),
// and a sparse, uneasy lead that rises and falls over a semitone (voice 3).
// Am F Am E.
//
// Patterns are 32 rows (two bars of sixteenths). Speed 7 makes a row 7 frames: about 107 beats a
// minute, a 36-second loop. EVENTS says which effects each of the game's events (core/raygame.js)
// starts.
(function (root, song) {
  if (typeof module === 'object' && module.exports) module.exports = song;
  else (root.APEXSONGS = root.APEXSONGS || {}).cell = song;
})(typeof self !== 'undefined' ? self : this, {
  speed: 7,
  effectsVoice: 1,
  filter: { res: 12, mode: 'low', min: 0x180, max: 0x480, period: 256 },
  instruments: {
    drone: { wave: 'saw', ad: 0x2a, sr: 0xa9, gate: 12, filter: true },
    pulse: { wave: 'pulse', ad: 0x05, sr: 0x35, pw: 0x300, pwSpeed: 16, gate: 2, filter: true },
    kick: { ad: 0x00, sr: 0xf5, pw: 0x800, gate: 4,
      table: [['pulse', 'C-3'], ['tri', 'A-2'], ['tri', 'F-2'], ['tri', 'D-2'], ['tri', 'A-1']] },
    tick: { ad: 0x00, sr: 0x00, gate: 1, table: [['noise', 'A-7']] },
    lead: { wave: 'pulse', ad: 0x4a, sr: 0x6a, pw: 0x180, pwSpeed: 12, gate: 10 },
  },
  patterns: {
    // the drone: a long root, then low pulses on the beat
    l1: 'A-1:drone . . . . . . . . . . . . . . . A-1:pulse . . . A-1 . . . A-1 . . . E-2 . . .',
    l2: 'F-1:drone . . . . . . . . . . . . . . . F-1:pulse . . . F-1 . . . F-1 . . . C-2 . . .',
    l3: 'E-1:drone . . . . . . . . . . . . . . . E-1:pulse . . . E-1 . . . G#1 . . . B-1 . . .',
    // the heartbeat: two beats close together, then the ticking
    h1: 'C-1:kick . . C-1:kick . . . . C-1:tick . . . C-1:tick . . . C-1:kick . . C-1:kick . . . . C-1:tick . . . C-1:tick . . .',
    // the lead: long notes that slip a semitone
    m1: 'E-4:lead . . . . . . . F-4 . . . . . . . E-4 . . . . . . . . . . . C-4 . . .',
    m2: 'D-4:lead . . . . . . . C-4 . . . . . . . A-3 . . . . . . . . . . . . . . .',
    m3: 'B-3:lead . . . . . . . C-4 . . . . . . . B-3 . . . . . . . G#3 . . . . . . .',
    m4: 'A-3:lead . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .',
    // silence, for the lead's first time round
    r1: '. . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .',
  },
  order: [
    ['l1', 'l2', 'l1', 'l3', 'l1', 'l2', 'l1', 'l3'],
    ['h1', 'h1', 'h1', 'h1', 'h1', 'h1', 'h1', 'h1'],
    ['r1', 'r1', 'r1', 'r1', 'm1', 'm2', 'm3', 'm4'],
  ],
  // in priority order, lowest first
  effects: {
    pickup: { priority: 0, steps: [
      { wave: 'pulse', freq: 0x2b00, ad: 0x00, sr: 0x89, pw: 0x800, ticks: 3 },
      { wave: 'pulse', freq: 0x3900, ad: 0x00, sr: 0x89, pw: 0x800, ticks: 3 },
      { wave: 'pulse', freq: 0x5600, ad: 0x00, sr: 0x89, pw: 0x800, ticks: 12 },
      { wave: 'pulse', gate: false, freq: 0x5600, ad: 0x00, sr: 0x89, pw: 0x800, ticks: 1 },
    ] },
    shot: { priority: 1, steps: [
      { wave: 'noise', freq: 0x2800, ad: 0x00, sr: 0xf0, ticks: 2 },
      { wave: 'noise', freq: 0x0c00, slide: -0x60, ad: 0x00, sr: 0xf0, ticks: 6 },
      { wave: 'noise', gate: false, freq: 0x0800, ad: 0x00, sr: 0xa0, ticks: 4 },
    ] },
    die: { priority: 2, steps: [
      { wave: 'noise', freq: 0x2000, ad: 0x00, sr: 0xf0, ticks: 2 },
      { wave: 'saw', freq: 0x1600, slide: 0x40, ad: 0x00, sr: 0xd8, ticks: 6 },
      { wave: 'saw', freq: 0x1800, slide: -0x50, ad: 0x00, sr: 0xd8, ticks: 24 },
      { wave: 'saw', gate: false, freq: 0x1000, ad: 0x00, sr: 0xd8, ticks: 8 },
    ] },
  },
  EVENTS: { pickup: ['pickup'], shot: ['shot'], die: ['die'] },
});
