/*
 * The C64 Crypt view: what the screen shows each frame of the game (core/crypt.js), exactly as the
 * engine is to show it. The dungeon is the iso view's (c64/iso/view.js), scrolled so the hero stays at
 * its centre; over it go the game's sprites, a status bar and the game's messages.
 *
 * Sprites are multicolor, 12 fat pixels by 21 rows, sharing red ($D025) and white ($D026); each has
 * its own colour. The hero is an investigator in a hat and coat with a pistol, seen from the side,
 * the front or the back as it aims; the drowned are hunched
 * fish-men, the spawn tentacled eyes. A creature out of the torchlight shows dimmed, and in the dark
 * only its eyes, glowing red.
 *
 * More sprites than the VIC's eight: as in the shooter, the objects are sorted by Y and the n-th one
 * shown gets a hardware sprite, here 7 - (n mod 8), so that the lower on the screen (nearer) an object
 * is, the more it is in front. An object starting less than GAP lines below the last one on its hardware
 * sprite is left out that frame. multiplex() is the rule.
 *
 * The status bar is the last 8 lines: hearts at the left, the score at the right.
 *
 * Works in Node and in the browser (global APEXCRYPTVIEW, needing APEXSCII, APEXISO, APEXISOVIEW and
 * APEXCRYPT).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../../core/iso.js'), require('../iso/view.js'), require('../../core/crypt.js'));
  else root.APEXCRYPTVIEW = factory(root.APEXISO, root.APEXISOVIEW, root.APEXCRYPT);
})(typeof self !== 'undefined' ? self : this, function (ISO, IV, G) {
  'use strict';

  const SPRITE = { mc1: 2, mc2: 1 }; // red, white
  const COLOR = { hero: 15, drowned: 5, spawn: 4, dim: 11, bullet: 7, dead: 2 };
  const GAP = 24;
  const BAR_LINE = 188;

  // ------------------------------------------------------------------ sprites
  // '.' clear, c red, a the sprite's own colour, w white. Drawn facing right; facing left mirrors.
  const art = rows => {
    const out = rows.map(r => Array.from(r.padEnd(12, '.'), ch => ({ c: 1, a: 2, w: 3 }[ch] || 0)));
    while (out.length < 21) out.unshift(new Array(12).fill(0));
    return out.slice(-21);
  };
  const HERO_TOP = [
    '....aaaa....', '...aaaaaa...', '.aaaaaaaaaa.', '....wwww....', '....wwwa....', '.....ww.....',
    '...aaccaa...', '..aaaccaaaa.', '..aaaccawwaa', '..aaaccaa..a', '..aaaaaaa...', '..aaaaaaa...',
    '...aaaaaa...', '...aaaaaa...',
  ];
  // Facing the viewer (aiming down the screen) and away from it (up).
  const HERO_FRONT = [
    '....aaaa....', '...aaaaaa...', '.aaaaaaaaaa.', '....wwww....', '....wwww....', '.....ww.....',
    '...aaccaa...', '..aaaccaaa..', '.waaaccaaaw.', '.aaaaccaaaaa', '..aaaaaaa...', '..aaaaaaa...',
    '...aaaaaa...', '...aaaaaa...',
  ];
  const HERO_BACK = [
    '....aaaa....', '...aaaaaa...', '.aaaaaaaaaa.', '....aaaa....', '....aaaa....', '.....ww.....',
    '...aaaaaa...', '..aaaaaaaa..', '.waaaaaaaaw.', '.aaaaaaaaaa.', '..aaaaaaa...', '..aaaaaaa...',
    '...aaaaaa...', '...aaaaaa...',
  ];
  const HERO_LEGS = {
    stand: ['...aa..aa...', '...aa..aa...', '...aa..aa...', '...aa..aa...', '..ccc..ccc..'],
    walk1: ['...aa...aa..', '..aa.....aa.', '..aa.....aa.', '.aa.......aa', '.ccc.....ccc'],
    walk2: ['....aaaa....', '....aaa.....', '.....aa.....', '.....aa.....', '....ccc.....'],
  };
  const DROWNED = [
    ['....aaaa....', '...aaaaaa...', '..aawaaawa..', '..aaaaaaaaa.', '...acccccaa.', '....aaaa....', '..a.aaaa.a..',
      '.aa.aaaa.aa.', '.a.aawwaa.a.', 'a..aawwaa..a', 'aa.aaaaaa.aa', '...aaaaaa...', '...aa..aa...', '...aa..aa...',
      '..aaa..aaa..', '.aa.a..a.aa.'],
    ['....aaaa....', '...aaaaaa...', '..aawaaawa..', '..aaaaaaaaa.', '...acccccaa.', '.a..aaaa..a.', '.aa.aaaa.aa.',
      '..aaaaaaaa..', '...aawwaa...', '...aawwaa...', '...aaaaaa...', '...aaaaaa...', '...aa...aa..', '..aa....aa..',
      '..aaa...aaa.', '.aa.a....a.a'],
  ];
  const SPAWN = [
    ['....aaaa....', '..aaaaaaaa..', '.aaawwwwaaa.', '.aawwccwwaa.', 'aaawwccwwaaa', '.aawwwwwwaa.', '.aaawwwwaaa.',
      '..aaaaaaaa..', '..a.aaaa.a..', '.a..a..a..a.', '.a.a...a.a..', 'a..a..a...a.', 'a...a.a..a..', '.a..a..a.a..'],
    ['....aaaa....', '..aaaaaaaa..', '.aaawwwwaaa.', '.aawwccwwaa.', 'aaawwccwwaaa', '.aawwwwwwaa.', '.aaawwwwaaa.',
      '..aaaaaaaa..', '..a.aaaa.a..', '..a.a..a.a..', '.a..a..a..a.', '.a...a..a..a', '..a..a.a...a', '..a.a..a..a.'],
  ];
  const FRAMES = {};
  for (const [name, legs] of Object.entries(HERO_LEGS)) {
    FRAMES['hero_side_' + name] = art([...HERO_TOP, ...legs]);
    FRAMES['hero_front_' + name] = art([...HERO_FRONT, ...legs]);
    FRAMES['hero_back_' + name] = art([...HERO_BACK, ...legs]);
  }
  // Which view of the hero shows for its aim: up the screen (1, 5, 9) its back, down (2, 6, 10) its front.
  const heroView = aim => ([1, 5, 9].includes(aim) ? 'back' : [2, 6, 10].includes(aim) ? 'front' : 'side');
  FRAMES.hero_dead = art(['............', '............', '.aaa........', 'aaaaaaaaaaww', 'awwaaccaaaa.', '.ww.aaaaaaaa']);
  DROWNED.forEach((r, k) => { FRAMES['drowned' + k] = art(r); });
  SPAWN.forEach((r, k) => { FRAMES['spawn' + k] = art(r); });
  // In the dark only the eyes show: the same rows, every pixel gone but the eyes, which glow red.
  const eyes = (rows, at) => art(rows.map((r, y) => Array.from(r, (ch, x) => (at(x, y, ch) ? 'c' : '.')).join('')));
  FRAMES.drowned_eyes = eyes(DROWNED[0], (x, y, ch) => ch === 'w' && y < 4);
  FRAMES.spawn_eyes = eyes(SPAWN[0], (x, y, ch) => ch === 'c');
  FRAMES.splat0 = art(['....a..a....', '..a.aaaa.a..', '.aaaaaaaaaa.', '..aaaccaaa..']);
  FRAMES.splat1 = art(['.a........a.', '..aa.aa.aa..', 'aaaaaaaaaaaa', '.aaaaccaaaa.']);
  FRAMES.bullet = art(['.....aa.....', '.....aa.....']);
  const FRAME_NAMES = Object.keys(FRAMES);

  // ------------------------------------------------------------------ light on the creatures
  // A creature's step of light, from where its feet are on the screen, as the iso view lights the
  // dungeon (without the dither): 0-1 lit, 2-3 dim, 4 dark.
  function lightStep(x, y) {
    const L = IV.LIGHT, d = Math.hypot(x - L.center.x, 2 * (y - L.center.y));
    return Math.max(0, Math.min(L.steps.length - 1, Math.floor((d - L.full) / L.step + 0.5)));
  }

  // ------------------------------------------------------------------ the objects
  // Where a point on the floor shows on the screen, with the hero's feet at IV.HERO.
  const onScreen = (h, o) => { const s = ISO.screen(o), c = ISO.screen(h); return { x: s.x - c.x + IV.HERO.x, y: s.y - c.y + IV.HERO.y }; };
  // What the game shows as sprites, in order: the hero, its bullets, the creatures.
  // [{ x, y (the sprite's top left), frame, color, flip }]
  function objects(g) {
    const out = [], h = g.hero;
    const feet = (o, frame, color, flip = false, lift = 0) => { const s = onScreen(h, o); out.push({ x: s.x - 12, y: s.y - 20 - lift, frame, color, flip }); };
    if (g.mode === G.OVER) feet(h, 'hero_dead', COLOR.hero, h.facing < 0);
    else if (!(h.invuln & 4)) feet(h, `hero_${heroView(h.aim)}_${IV.spriteFrame(h)}`, COLOR.hero, h.facing < 0);
    for (const b of g.bullets) if (b.on) feet(b, 'bullet', COLOR.bullet, false, 10);
    for (const c of g.creatures) {
      if (!c.hp && !c.dying) continue;
      const name = c.kind === G.DROWNED ? 'drowned' : 'spawn', s = onScreen(h, c);
      if (c.dying) { feet(c, c.dying > G.DYING / 2 ? 'splat0' : 'splat1', COLOR[name]); continue; }
      const step = lightStep(s.x, s.y - 10);
      if (step >= 4) { feet(c, name + '_eyes', COLOR[name], c.facing < 0); continue; }
      const frame = name + (c.awake ? (c.t >> 3) & 1 : 0);
      feet(c, frame, c.flash ? 1 : step >= 2 ? COLOR.dim : COLOR[name], c.facing < 0);
    }
    return out;
  }

  // The multiplexer's rule (see the top): which hardware sprite shows each object, in front first.
  function multiplex(objs) {
    const order = objs.map((o, i) => [o, i]).filter(([o]) => o.y > -21 && o.y < 200 && o.x > -24 && o.x < 344)
      .sort((a, b) => a[0].y - b[0].y || a[1] - b[1]);
    const lastY = new Array(8).fill(-1000), shown = [];
    let n = 0;
    for (const [o] of order) {
      const hw = 7 - (n & 7);
      if (o.y < lastY[hw] + GAP) continue;
      lastY[hw] = o.y;
      shown.push({ ...o, hw });
      n++;
    }
    return shown.sort((a, b) => a.hw - b.hw);
  }

  // ------------------------------------------------------------------ text
  const FONT = {
    '0': '111 101 101 101 111', '1': '010 110 010 010 111', '2': '111 001 111 100 111', '3': '111 001 111 001 111',
    '4': '101 101 111 001 001', '5': '111 100 111 001 111', '6': '111 100 111 101 111', '7': '111 001 010 010 010',
    '8': '111 101 111 101 111', '9': '111 101 111 001 111', A: '010 101 111 101 101', C: '011 100 100 100 011',
    D: '110 101 101 101 110', E: '111 100 110 100 111', F: '111 100 110 100 100', H: '101 101 111 101 101',
    I: '111 010 010 010 111', L: '100 100 100 100 111', N: '110 101 101 101 101', O: '010 101 101 101 010',
    P: '110 101 110 100 100', R: '110 101 110 101 101', S: '011 100 010 001 110', T: '111 010 010 010 010',
    U: '101 101 101 101 111', V: '101 101 101 101 010', W: '101 101 111 111 101', Y: '101 101 010 010 010',
    ' ': '000 000 000 000 000', '*': '000 101 111 111 010',
  };
  // The messages: [text, top line, colour, scale]. PRESS FIRE blinks.
  const TEXT = {
    title: [['THE DROWNED', 24, 5, 2], ['CRYPT', 40, 5, 2], ['PRESS FIRE', 164, 1, 1]],
    win: [['THE DEEP', 70, 7, 2], ['SLEEPS', 86, 7, 2]],
    over: [['DEVOURED', 78, 2, 2]],
  };
  const digits = (v, n) => String(v).padStart(n, '0').slice(-n);

  // ------------------------------------------------------------------ a frame
  const PAL = IV.PAL;
  function frame(M, g) {
    const out = new Uint8ClampedArray(320 * 200 * 4);
    const put = (x, y, c) => { if (x < 0 || x >= 320 || y < 0 || y >= 200) return; const i = (y * 320 + x) * 4; out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2]; out[i + 3] = 255; };
    const sc = IV.background(M, g.hero, put);
    const sprites = multiplex(objects(g));
    for (const s of [...sprites].reverse()) {
      const f = FRAMES[s.frame], cols = [null, SPRITE.mc1, s.color, SPRITE.mc2];
      for (let r = 0; r < 21; r++) for (let c = 0; c < 12; c++) {
        const v = f[r][s.flip ? 11 - c : c];
        if (v) for (const dx of [0, 1]) put(s.x + 2 * c + dx, s.y + r, PAL[cols[v]]);
      }
    }
    // text: 3x5 letters a fat pixel each (scale tall), with a shadow down and right
    const write = (text, top, color, scale) => {
      const w = text.length * 4 * 2 - 2, left = 160 - (w >> 1);
      for (const [dx, dy, c] of [[2, 1, 0], [0, 0, color]]) [...text].forEach((ch, k) => {
        const rows = FONT[ch].split(' ');
        for (let y = 0; y < 5 * scale; y++) for (let x = 0; x < 3; x++) if (rows[Math.floor(y / scale)][x] === '1')
          for (const px of [0, 1]) put(left + 8 * k + 2 * x + px + dx, top + y + dy, PAL[c]);
      });
    };
    const lines = g.mode === G.TITLE ? TEXT.title.filter(([t]) => t !== 'PRESS FIRE' || (g.t >> 5) & 1) : g.mode === G.WIN ? TEXT.win : g.mode === G.OVER ? TEXT.over : [];
    for (const l of lines) write(...l);
    // the status bar
    for (let y = BAR_LINE; y < BAR_LINE + 8; y++) for (let x = 0; x < 320; x++) put(x, y, PAL[0]);
    const barText = (col, text, color) => [...text].forEach((ch, k) => {
      const rows = FONT[ch].split(' ');
      for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) if (rows[y][x] === '1') {
        put(8 * (col + k) + 2 * x + 2, BAR_LINE + 2 + y, PAL[11]);
        put(8 * (col + k) + 2 * x, BAR_LINE + 1 + y, PAL[color]);
      }
    });
    if (g.mode === G.TITLE) barText(15, 'HI ' + digits(g.hi, 6), 1);
    else {
      barText(1, '***'.slice(0, g.hero.hearts).padEnd(3, ' '), 10);
      barText(33, digits(g.score, 6), 1);
    }
    for (let y = 0; y < 200; y++) for (let x = 0; x < 320; x++) if (x < 7 || x >= 311 || y < 4 || y >= 196) put(x, y, PAL[IV.COLORS.border]);
    return { pixels: out, scroll: sc, sprites };
  }

  return { SPRITE, COLOR, GAP, BAR_LINE, FRAMES, FRAME_NAMES, FONT, TEXT, lightStep, onScreen, objects, multiplex, frame };
});
