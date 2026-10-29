// The Dreadnought's sound (core/sound.js): an original late-80s house track, and the shoot-'em-up's
// effects. A four-on-the-floor kick with offbeat hats and claps on 2 and 4 (drum tables on voice 3),
// an octave-jumping bass through a resonant low-pass whose cutoff sweeps (voice 1), and arpeggiated
// chord stabs that give way to a hook (voice 2, which the effects borrow, so firing never stops the
// beat). A minor, Am - F - G - E.
//
// Patterns are 32 rows (two bars of sixteenths): a note (with :instrument to change it), . (nothing:
// the note goes on) or == (release). Speed 6 makes a row 6 frames: 125 beats a minute, a 31-second
// loop.
(function (root, song) {
  if (typeof module === 'object' && module.exports) module.exports = song;
  else (root.APEXSONGS = root.APEXSONGS || {}).shmup = song;
})(typeof self !== 'undefined' ? self : this, {
  speed: 6,
  effectsVoice: 1,
  filter: { res: 12, mode: 'low', min: 0x180, max: 0x5c0, period: 192 },
  instruments: {
    bass: { wave: 'saw', ad: 0x06, sr: 0x00, gate: 3, filter: true },
    minor: { wave: 'pulse', ad: 0x05, sr: 0x00, pw: 0x500, pwSpeed: 40, arp: [0, 3, 7], gate: 3 },
    major: { wave: 'pulse', ad: 0x05, sr: 0x00, pw: 0x500, pwSpeed: 40, arp: [0, 4, 7], gate: 3 },
    hook: { wave: 'pulse', ad: 0x09, sr: 0x84, pw: 0x300, pwSpeed: 24, gate: 9 },
    // drums: a pitch that falls fast (kick), noise (hat), noise then the kick's fall (clap)
    kick: { ad: 0x00, sr: 0xf4, pw: 0x800, gate: 7,
      table: [['pulse', 'F#3'], ['pulse', 'C#3'], ['tri', 'A-2'], ['tri', 'F-2'], ['tri', 'D-2'], ['tri', 'B-1'], ['tri', 'A-1']] },
    hat: { ad: 0x02, sr: 0x00, gate: 2, table: [['noise', 'B-7']] },
    clap: { ad: 0x00, sr: 0xf6, pw: 0x800, gate: 8,
      table: [['noise', 'E-6'], ['noise', 'E-6'], ['noise', 'C-6'], ['pulse', 'C#3'], ['tri', 'A-2'], ['tri', 'F-2'], ['tri', 'D-2'], ['tri', 'B-1']] },
  },
  patterns: {
    sil: '. . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .',
    // the bass: root, octave, root on the sixteenths
    b1: 'A-1:bass . A-2 A-1 . A-1 A-2 . A-1 . A-2 A-1 . A-1 A-2 . F-1 . F-2 F-1 . F-1 F-2 . F-1 . F-2 F-1 . F-1 F-2 .',
    b2: 'G-1:bass . G-2 G-1 . G-1 G-2 . G-1 . G-2 G-1 . G-1 G-2 . E-1 . E-2 E-1 . E-1 E-2 . E-1 . E-2 E-1 . E-1 E-2 .',
    // chord stabs, off the beat
    s1: '. . A-3:minor . . . A-3 . . A-3 . . A-3 . . . . . F-3:major . . . F-3 . . F-3 . . F-3 . . .',
    s2: '. . G-3:major . . . G-3 . . G-3 . . G-3 . . . . . E-3:minor . . . E-3 . . E-3 . . E-3 . . .',
    // the hook
    h1: 'E-4:hook . . E-4 . . G-4 . A-4 . . G-4 . E-4 . . F-4 . . F-4 . . A-4 . C-5 . . A-4 . F-4 . .',
    h2: 'D-4:hook . . D-4 . . G-4 . B-4 . . G-4 . D-4 . . E-4 . . E-4 . . G#4 . B-4 . . G#4 . E-4 . .',
    // the drums: kick, hat, clap, hat on every beat; a clap roll to end the second
    d1: 'C-1:kick . C-1:hat . C-1:clap . C-1:hat . C-1:kick . C-1:hat . C-1:clap . C-1:hat . C-1:kick . C-1:hat . C-1:clap . C-1:hat . C-1:kick . C-1:hat . C-1:clap . C-1:hat .',
    d2: 'C-1:kick . C-1:hat . C-1:clap . C-1:hat . C-1:kick . C-1:hat . C-1:clap . C-1:hat . C-1:kick . C-1:hat . C-1:clap . C-1:hat . C-1:kick . C-1:clap . C-1:clap C-1:clap C-1:clap C-1:clap',
  },
  order: [
    ['sil', 'b1', 'b1', 'b2', 'b1', 'b2', 'b1', 'b2'],
    ['sil', 'sil', 's1', 's2', 's1', 'h2', 'h1', 's2'],
    ['d1', 'd1', 'd1', 'd2', 'd1', 'd1', 'd1', 'd2'],
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
});
