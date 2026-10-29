/*
 * The Drowned Crypt's sprites: multicolor, 12 fat pixels by 21 rows, one character per fat pixel:
 *   . clear    k black ($D025: outlines, shadow)    s light red ($D026: skin, eyes, gums)
 *   a the sprite's own colour (the hero's coat, a creature's hide)
 * Shorter images sit at the bottom of the sprite (their feet on its last row). Drawn facing right, or
 * facing the viewer; the view mirrors them to face left.
 *
 * Works in Node and in the browser (global APEXCRYPTSPRITES).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.APEXCRYPTSPRITES = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const COLORS = { mc1: 0, mc2: 10 }; // black, light red

  // ------------------------------------------------------------------ the investigator
  // A hat with a black band, a coat and trousers, black shoes; the pistol in the right hand.
  const HAT = ['....kkkk....', '...kaaaak...', '...kaaaak...', '..kkkkkkkk..', '.kaaaaaaaak.', '..kkkkkkkk..'];
  const SIDE = [
    ...HAT,
    '...kssssk...', '...kssksk...', '....kssk....', '...kkaakk...', '..kaaaaakkkk', '..kaaaassk..', '..kaaaaak...',
    '..kaaaaak...', '..kaakaak...',
  ];
  const FRONT = [
    ...HAT,
    '...kssssk...', '...kksskk...', '....kssk....', '..kkaaaakk..', '.kaaaaaaaak.', '.kaaaaaaaak.', '.ksaaaaaask.',
    '.kskaaaakkk.', '..kaakkaak..',
  ];
  const BACK = [
    ...HAT,
    '...kkkkkk...', '...kkkkkk...', '....kkkk....', '..kkaaaakk..', '.kaaaaaaaak.', '.kaaaaaaaak.', '.ksaaaaaask.',
    '.kkaaaaaask.', '..kaaaaaak..',
  ];
  const LEGS = {
    stand: ['..kaakkaak..', '..kaak.kaak.', '..kaak.kaak.', '..kaak.kaak.', '..kkkk.kkkk.'],
    walk1: ['..kaakkaak..', '.kaak..kaak.', '.kaak...kaak', 'kaak....kaak', 'kkkk....kkkk'],
    walk2: ['...kaaaak...', '...kaaak....', '....kaak....', '....kaak....', '....kkkk....'],
  };
  const DEAD = ['............', '............', '..kkkk......', '.kaaaakkkkkk', 'kaaaaaaaaaak', 'kkssaaaaaaak', '.kkkkkkkkkk.'];

  // ------------------------------------------------------------------ the drowned
  // A hunched fish-man facing the viewer: wide-set staring eyes in a broad head, a gaping mouth,
  // long arms ending in webbed claws.
  const DROWNED_HEAD = [
    '...kkkkkk...', '..kaaaaaak..', '.kaaaaaaaak.', 'kassaaaassak', 'kaskaaaaksak', '.kaaaaaaaak.', '.kakkkkkkak.',
    '.kaksssskak.', '..kakkkkak..', '..kkaaaakk..',
  ];
  const DROWNED = [
    [...DROWNED_HEAD, '.kaaaaaaaak.', 'kaakaaaakaak', 'kaakaaaakaak', 'kak.kaak.kak', 'kak.kaak.kak', 'kkk.kaak.kkk',
      '...kaaaak...', '...kakkak...', '..kaak.kak..', '..kaak.kaak.', '..kkkk.kkkk.'],
    [...DROWNED_HEAD, '.kaaaaaaaak.', 'kaakaaaakaak', '.kakaaaakak.', '.kakaaaakak.', '..kkaaaakak.', '..kkaaaakkk.',
      '...kaaaak...', '...kakkak...', '...kak.kaak.', '..kaak..kak.', '..kkkk..kkkk'],
  ];

  // ------------------------------------------------------------------ the spawn
  // A swollen sac around one great eye, on a nest of tentacles that writhe.
  const SPAWN_BODY = [
    '....kkkk....', '..kkaaaakk..', '.kaaaaaaaak.', '.kaakkkkaak.', 'kaaksssskaak', 'kaksskksskak', 'kaaksssskaak',
    '.kaakkkkaak.', '.kaaaaaaaak.', '..kaaaaaak..',
  ];
  const SPAWN = [
    [...SPAWN_BODY, '.kakakkakak.', 'kak.kaak.kak', 'ka.kak.kak.k', 'ka.ka..ka.ak', '.ka.ak.ka.k.', '.ka.ak..ka..',
      '..k..ak.ak..', '.....k...k..'],
    [...SPAWN_BODY, '.kakakkakak.', 'kak.kaak.kak', 'k.kak.kak.ak', 'ka.ak..ak.ak', '.ka.ka.ak.k.', '..ka.ka.ak..',
      '..ak..k..k..', '..k.........'],
  ];

  // ------------------------------------------------------------------ the rest
  const SPLAT = [
    ['....k..k....', '..k.kaak.k..', '.kaakaaakak.', 'kaaaaaaaaaak', '.kkaaakaakk.'],
    ['.k........k.', '..ka.kk.ak..', 'kaaakaakaaak', 'kaaaaaaaaaak', '.kkkkkkkkkk.'],
  ];
  const BULLET = ['.....ss.....', '.....aa.....'];

  // In the dark only the eyes show: the eye pixels (s) of a frame's first rows, glowing, nothing else.
  const eyes = (rows, upTo) => rows.map((r, y) => (y < upTo ? r.replace(/[^s]/g, '.') : '............'));

  const IMAGES = {};
  for (const [name, legs] of Object.entries(LEGS)) {
    IMAGES['hero_side_' + name] = [...SIDE, ...legs];
    IMAGES['hero_front_' + name] = [...FRONT, ...legs];
    IMAGES['hero_back_' + name] = [...BACK, ...legs];
  }
  IMAGES.hero_dead = DEAD;
  DROWNED.forEach((r, k) => { IMAGES['drowned' + k] = r; });
  SPAWN.forEach((r, k) => { IMAGES['spawn' + k] = r; });
  IMAGES.drowned_eyes = eyes(DROWNED[0], 5);
  IMAGES.spawn_eyes = eyes(SPAWN[0], 8);
  SPLAT.forEach((r, k) => { IMAGES['splat' + k] = r; });
  IMAGES.bullet = BULLET;

  // Each image as 21 rows of 12 values (0 clear, 1 black, 2 own colour, 3 light red).
  const FRAMES = {};
  for (const [name, rows] of Object.entries(IMAGES)) {
    if (rows.length > 21 || rows.some(r => r.length !== 12)) throw new Error(`sprite ${name}: rows must be 12 wide, 21 at most`);
    const out = rows.map(r => Array.from(r, ch => ({ k: 1, a: 2, s: 3 }[ch] || 0)));
    while (out.length < 21) out.unshift(new Array(12).fill(0));
    FRAMES[name] = out;
  }
  return { COLORS, IMAGES, FRAMES };
});
