// The Drowned Crypt's sound (core/sound.js): original creeping music in the manner of a 1920s silent
// film's mysterioso cue, and the game's effects. D minor, slow: a plucked bass on beats 1 and 3
// walking chromatically into each change (voice 1, through a dark low-pass), stride-like chords on
// 2 and 4 as quick arpeggios (voice 2, which the hero's and the creatures' effects borrow), and a
// melody that tiptoes up in plucked notes onto ghostly held ones (voice 3). Dm Dm Gm A7, Dm Bb Gm A7.
// The plucked notes ring on as they release; the hero's and the creatures' effects are short and
// sustain nothing, so they tick over the music rather than drown it.
//
// Patterns are 32 rows: four bars of eighths. Speed 10 makes a row 10 frames: 75 beats a minute, a
// 38-second loop.
//
// When the boss rises the game turns the music off, and the boss's effects have voices 1 and 3 to
// themselves: a roar over a rumble as it rises, moans, a screech as it spits, the floor cracking and a
// tentacle bursting up, a shriek over a collapse as it dies. EVENTS says which effects each of the
// game's events (core/crypt.js) starts.
(function (root, song) {
  if (typeof module === 'object' && module.exports) module.exports = song;
  else (root.APEXSONGS = root.APEXSONGS || {}).crypt = song;
})(typeof self !== 'undefined' ? self : this, {
  speed: 10,
  effectsVoice: 1,
  filter: { res: 10, mode: 'low', min: 0x1c0, max: 0x480, period: 256 },
  instruments: {
    pizz: { wave: 'pulse', ad: 0x0a, sr: 0x0a, pw: 0x600, gate: 2, filter: true },
    mi: { wave: 'pulse', ad: 0x08, sr: 0x48, pw: 0x400, pwSpeed: 24, arp: [0, 3, 7], gate: 3 },
    ma: { wave: 'pulse', ad: 0x08, sr: 0x48, pw: 0x400, pwSpeed: 24, arp: [0, 4, 7], gate: 3 },
    dom: { wave: 'pulse', ad: 0x08, sr: 0x48, pw: 0x400, pwSpeed: 24, arp: [0, 4, 7, 10], gate: 3 },
    pluck: { wave: 'pulse', ad: 0x09, sr: 0x29, pw: 0x200, pwSpeed: 8, gate: 4 },
    ghost: { wave: 'tri', ad: 0x89, sr: 0xa8 },
  },
  patterns: {
    sil: '. . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .',
    // the bass: Dm Dm Gm A7, then Dm Bb Gm A7, walking into the changes
    bassA: 'D-2:pizz . . . A-1 . . . D-2 . . . A-1 . C#2 . G-1 . . . D-2 . . . A-1 . . . E-1 . C#2 .',
    bassB: 'D-2:pizz . . . A-1 . . . A#1 . . . F-1 . . . G-1 . . . D-2 . E-2 . A-1 . . . C#2 . A-1 .',
    // the chords, on 2 and 4
    chA: '. . D-3:mi . . . D-3 . . . D-3 . . . D-3 . . . G-2:mi . . . G-2 . . . A-2:dom . . . A-2 .',
    chB: '. . D-3:mi . . . D-3 . . . A#2:ma . . . A#2 . . . G-2:mi . . . G-2 . . . A-2:dom . . . A-2 .',
    // the melody: creeping up in plucked notes onto held ones
    melA: 'D-4:pluck . E-4 . F-4 . F#4 . G-4:ghost . . . F#4:pluck . F-4 . E-4:ghost . . . D#4:pluck . E-4 . A-3:ghost . . . . . == .',
    melB: 'D-4:pluck . E-4 . F-4 . G#4 . A-4:ghost . . . A#4:pluck . A-4 . G-4 . E-4 . C#4 . E-4 . D-4:ghost . . . . . == .',
    melC: 'A-4:ghost . . . . . G#4:pluck . A-4:ghost . . . . . A#4:pluck . A#4:ghost . . . A-4:pluck . G-4 . C#5:ghost . . . . . == .',
  },
  order: [
    ['bassA', 'bassB', 'bassA', 'bassB', 'bassA', 'bassB'],
    ['chA', 'chB', 'chA', 'chB', 'chA', 'chB'],
    ['sil', 'sil', 'melA', 'melB', 'melC', 'melB'],
  ],
  // in priority order on each voice, lowest first
  effects: {
    // the hero's and the creatures', on voice 2
    shot: { priority: 0, steps: [
      { wave: 'noise', freq: 0x5000, ad: 0x03, sr: 0x00, ticks: 2 },
      { wave: 'noise', gate: false, freq: 0x1800, ad: 0x03, sr: 0x00, ticks: 1 },
    ] },
    wake: { priority: 1, steps: [
      { wave: 'tri', freq: 0x0500, slide: 0x40, ad: 0x06, sr: 0x50, ticks: 8 },
      { wave: 'saw', freq: 0x0700, slide: -0x60, ad: 0x06, sr: 0x50, ticks: 6 },
      { wave: 'saw', gate: false, freq: 0x0400, ad: 0x06, sr: 0x50, ticks: 1 },
    ] },
    hit: { priority: 2, steps: [
      { wave: 'pulse', freq: 0x0600, ad: 0x04, sr: 0x00, pw: 0x400, ticks: 2 },
      { wave: 'noise', gate: false, freq: 0x2000, ad: 0x04, sr: 0x00, ticks: 1 },
    ] },
    kill: { priority: 3, steps: [
      { wave: 'noise', freq: 0x1800, slide: -0x80, ad: 0x08, sr: 0x60, ticks: 10 },
      { wave: 'noise', gate: false, freq: 0x0c00, slide: -0x40, ad: 0x08, sr: 0x66, ticks: 4 },
    ] },
    start: { priority: 4, steps: [
      { wave: 'tri', freq: 0x1250, ad: 0x00, sr: 0xa6, ticks: 8 },
      { wave: 'tri', freq: 0x1d50, ad: 0x00, sr: 0xa6, ticks: 8 },
      { wave: 'tri', gate: false, freq: 0x1d50, ad: 0x00, sr: 0xa6, ticks: 1 },
    ] },
    hurt: { priority: 5, steps: [
      { wave: 'pulse', freq: 0x0900, slide: -0x60, ad: 0x06, sr: 0x86, pw: 0x300, ticks: 8 },
      { wave: 'noise', gate: false, freq: 0x1000, ad: 0x06, sr: 0x86, ticks: 4 },
    ] },
    win: { priority: 6, steps: [
      { wave: 'tri', freq: 0x1250, ad: 0x00, sr: 0xa8, ticks: 10 },
      { wave: 'tri', freq: 0x15d0, ad: 0x00, sr: 0xa8, ticks: 10 },
      { wave: 'tri', freq: 0x1b70, ad: 0x00, sr: 0xa8, ticks: 10 },
      { wave: 'tri', freq: 0x24a0, ad: 0x00, sr: 0xaa, ticks: 30 },
      { wave: 'tri', gate: false, freq: 0x24a0, ad: 0x00, sr: 0xaa, ticks: 1 },
    ] },
    dead: { priority: 7, steps: [
      { wave: 'saw', freq: 0x2000, slide: -0x30, ad: 0x00, sr: 0xfa, ticks: 60 },
      { wave: 'saw', gate: false, freq: 0x0a00, slide: -0x10, ad: 0x00, sr: 0xfa, ticks: 20 },
    ] },
    // the boss's, on voices 1 and 3 (the music off)
    moan: { voice: 0, priority: 0, steps: [
      { wave: 'tri', freq: 0x0380, slide: 0x05, ad: 0x8a, sr: 0xa9, ticks: 30 },
      { wave: 'saw', freq: 0x0420, slide: -0x07, ad: 0x8a, sr: 0xa9, ticks: 40 },
      { wave: 'saw', gate: false, freq: 0x0300, slide: -0x04, ad: 0x8a, sr: 0xa9, ticks: 30 },
    ] },
    grasp: { voice: 0, priority: 1, steps: [
      { wave: 'noise', freq: 0x0c00, slide: 0x100, ad: 0x00, sr: 0xc0, ticks: 10 },
      { wave: 'saw', freq: 0x0600, slide: 0x80, ad: 0x00, sr: 0xc0, ticks: 12 },
      { wave: 'saw', gate: false, freq: 0x0c00, slide: -0x80, ad: 0x00, sr: 0xc0, ticks: 8 },
    ] },
    roar: { voice: 0, priority: 2, steps: [
      { wave: 'saw', freq: 0x0300, slide: 0x08, ad: 0x88, sr: 0xfa, ticks: 40 },
      { wave: 'saw', freq: 0x0640, slide: -0x10, ad: 0x88, sr: 0xfa, ticks: 40 },
      { wave: 'saw', gate: false, freq: 0x0240, slide: -0x04, ad: 0x88, sr: 0xfa, ticks: 20 },
    ] },
    collapse: { voice: 0, priority: 3, steps: [
      { wave: 'noise', freq: 0x0700, slide: -0x10, ad: 0x00, sr: 0xfb, ticks: 60 },
      { wave: 'noise', gate: false, freq: 0x0340, slide: -0x04, ad: 0x00, sr: 0xfb, ticks: 30 },
    ] },
    crack: { voice: 2, priority: 0, steps: [
      { wave: 'noise', freq: 0x0900, ad: 0x00, sr: 0x90, ticks: 3 },
      { wave: 'noise', freq: 0x1600, ad: 0x00, sr: 0x90, ticks: 2 },
      { wave: 'noise', gate: false, freq: 0x0700, ad: 0x00, sr: 0x90, ticks: 6 },
    ] },
    screech: { voice: 2, priority: 1, steps: [
      { wave: 'saw', freq: 0x3000, slide: 0x200, ad: 0x00, sr: 0xd8, ticks: 10 },
      { wave: 'noise', freq: 0x6000, slide: -0x300, ad: 0x00, sr: 0xd8, ticks: 8 },
      { wave: 'saw', gate: false, freq: 0x2400, slide: -0x100, ad: 0x00, sr: 0xd8, ticks: 10 },
    ] },
    rumble: { voice: 2, priority: 2, steps: [
      { wave: 'noise', freq: 0x0300, ad: 0x6a, sr: 0xfb, ticks: 60 },
      { wave: 'noise', gate: false, freq: 0x0280, ad: 0x6a, sr: 0xfb, ticks: 20 },
    ] },
    shriek: { voice: 2, priority: 3, steps: [
      { wave: 'saw', freq: 0x4000, slide: 0x100, ad: 0x00, sr: 0xfa, ticks: 20 },
      { wave: 'saw', freq: 0x6000, slide: -0x200, ad: 0x00, sr: 0xfa, ticks: 30 },
      { wave: 'saw', gate: false, freq: 0x2000, slide: -0x80, ad: 0x00, sr: 0xfa, ticks: 30 },
    ] },
  },
  // the effects each of the game's events starts
  EVENTS: {
    shot: ['shot'], wake: ['wake'], hit: ['hit'], kill: ['kill'], start: ['start'], hurt: ['hurt'], win: ['win'],
    dead: ['dead'], moan: ['moan'], grasp: ['grasp'], rise: ['roar', 'rumble'], crack: ['crack'], spit: ['screech'],
    bossDies: ['shriek', 'collapse'],
  },
});
