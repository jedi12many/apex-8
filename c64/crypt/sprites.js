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
  // A hat with a black band, a raincoat to the ankles, black shoes; the pistol in the right hand. The
  // coat's hem swings as he walks, flaring out behind from the side.
  const HAT = ['....kkkk....', '...kaaaak...', '...kaaaak...', '..kkkkkkkk..', '.kaaaaaaaak.', '..kkkkkkkk..'];
  const SIDE = [
    ...HAT,
    '...kssssk...', '...kssksk...', '....kssk....', '...kkaakk...', '..kaaaaakkkk', '..kaaaassk..', '..kaaaaak...',
    '..kaaaaak...',
  ];
  const FRONT = [
    ...HAT,
    '...kssssk...', '...kksskk...', '....kssk....', '..kkaaaakk..', '.kaaaaaaaak.', '.kaaaaaaaak.', '.ksaaaaaask.',
    '.kskaaaakkk.',
  ];
  const BACK = [
    ...HAT,
    '...kkkkkk...', '...kkkkkk...', '....kkkk....', '..kkaaaakk..', '.kaaaaaaaak.', '.kaaaaaaaak.', '.ksaaaaaask.',
    '.kkaaaaaask.',
  ];
  // The coat below the waist and the shoes under its hem, for each view and step.
  const COAT = {
    side: {
      stand: ['..kaaaaak...', '..kaaaaak...', '..kaaaaak...', '..kaaaaaak..', '..kaaaaaak..', '..kkkkkkkk..', '...kk.kk....'],
      walk1: ['..kaaaaak...', '..kaaaaak...', '.kaaaaaak...', '.kaaaaaaak..', 'kaaaaaaaak..', 'kkkkkkkkkk..', '.kk....kk...'],
      walk2: ['..kaaaaak...', '..kaaaaak...', '..kaaaaak...', '.kaaaaaak...', '.kaaaaaaak..', '.kkkkkkkkk..', '....kkk.....'],
    },
    front: {
      stand: ['..kaaaaaak..', '..kaaaaaak..', '..kaakkaak..', '..kaakkaak..', '.kaaakkaaak.', '.kkkk..kkkk.', '..kk....kk..'],
      walk1: ['..kaaaaaak..', '..kaaaaaak..', '..kaakkaak..', '.kaaak.kaak.', '.kaaak..kaak', '.kkkk...kkkk', '.kk......kk.'],
      walk2: ['..kaaaaaak..', '..kaaaaaak..', '..kaakkaak..', '..kaakkaak..', '..kaakkaak..', '..kkkkkkkk..', '....kkkk....'],
    },
    back: {
      stand: ['..kaaaaaak..', '..kaaaaaak..', '..kaaaaaak..', '..kaaaaaak..', '.kaaakkaaak.', '.kkkkkkkkkk.', '..kk....kk..'],
      walk1: ['..kaaaaaak..', '..kaaaaaak..', '..kaaaaaak..', '.kaaaaaaak..', '.kaaak.kaaak', '.kkkk..kkkkk', '.kk......kk.'],
      walk2: ['..kaaaaaak..', '..kaaaaaak..', '..kaaaaaak..', '..kaaaaaak..', '..kaakkaak..', '..kkkkkkkk..', '....kkkk....'],
    },
  };
  const DEAD = ['............', '............', '..kkkk......', '.kaaaakkkkkk', 'kaaaaaaaaaak', 'kkssaaaaaaaa', 'kaaaaaaaaaak', '.kkkkkkkkkkk'];

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

  // ------------------------------------------------------------------ the Mother of the Deep
  // The boss: 36 fat pixels by 42 rows, cut into 3 x 2 sprites. Drawn from shapes on the real pixel
  // grid (72 x 42, a fat pixel 2 wide), back to front, then outlined in black where a shape meets
  // nothing: thick tentacles curling up from the pit behind; a domed head, wrinkled and shaded from
  // the upper left, ringed with small eyes above two great slit-eyed ones; a beard of face-tentacles
  // with suckers over its maw (parted, and the maw gaping, when it spits); clawed hands gripping the
  // broken rim of the pit it rose from. step (0, 1) sways the tentacles.
  const BW = 36, BH = 42, RIM = 37;
  // A quadratic curve's points, every half pixel.
  const curve = (a, b, c) => {
    const pts = [];
    for (let i = 0; i <= 80; i++) {
      const t = i / 80, u = 1 - t;
      pts.push([u * u * a[0] + 2 * u * t * b[0] + t * t * c[0], u * u * a[1] + 2 * u * t * b[1] + t * t * c[1], t]);
    }
    return pts;
  };
  // How far (x, y) is inside a thick curve (width w0 at its start to w1 at its end): > 0 inside, and
  // the curve's t there.
  function onCurve(pts, w0, w1, x, y) {
    let best = -Infinity, bt = 0;
    for (const [px, py, t] of pts) {
      const d = (w0 + (w1 - w0) * t) / 2 - Math.hypot((x - px) / 1.15, y - py);
      if (d > best) { best = d; bt = t; }
    }
    return [best, bt];
  }
  function bossBody(open, step) {
    const g = Array.from({ length: BH }, () => new Array(BW).fill('.'));
    const sway = step ? 1 : -1;
    for (let r = 0; r < BH; r++) for (let c = 0; c < BW; c++) {
      const x = 2 * c + 1, y = r + 0.5, side = x < 36 ? -1 : 1, mx = 36 + Math.abs(x - 36); // mx: mirrored to the right half
      let v = '.';
      // the great tentacles behind, curling up and out from the pit (each side its own phase)
      const ph = side < 0 ? sway : -sway;
      const big = curve([52, 38], [70 + 2 * ph, 22], [60 - 3 * ph, 4 + ph]);
      const [bd, bt] = onCurve(big, 10, 4, mx, y);
      if (bd > 0) v = bd < 0.9 ? 'k' : bt > 0.2 && Math.round(bt * 40) % 6 === 0 && bd > 1.6 ? 's' : 'a';
      // the body: a domed head over a body that widens to the pit
      const head = ((x - 36) / 21) ** 2 + ((y - 15) / 14) ** 2 < 1;
      const lower = y > 17 && y < RIM && Math.abs(x - 36) < 15 + (y - 17) * 0.55;
      if (head || lower) {
        v = 'a';
        const shade = (x - 36) / 22 + (y - 12) / 26; // lit upper left, dark lower right
        if (shade > 0.75 && (c + r) & 1) v = 'k';
        if (shade > 1.05) v = 'k';
        // wrinkles across the dome
        if (y < 11 && Math.abs(Math.hypot((x - 36) / 1.6, y - 26) - 19) < 0.5 && c & 1) v = 'k';
        // small eyes on the brow, then the two great ones with slit pupils
        if ([[24, 7], [31, 4], [41, 4], [48, 7]].some(([ex, ey]) => Math.abs(x - ex) < 2 && Math.abs(y - ey) < 1)) v = 's';
        const ex = 36 + 9 * side, eIn = ((x - ex) / 6.5) ** 2 + ((y - 14.5) / 3.4) ** 2;
        if (eIn < 1) v = Math.abs(x - ex) < 1 && Math.abs(y - 14.5) < 2.5 ? 'k' : 's';
        else if (eIn < 1.6 && y < 13) v = 'k'; // the brow over each eye
      }
      // the beard: six face-tentacles hanging over the maw, swaying
      for (let k = 0; k < 6; k++) {
        const bx = 23 + 5.2 * k, part = open && (k === 2 || k === 3) ? (k === 2 ? -5 : 5) : 0;
        const tip = bx + part + ((k & 1 ? 1 : -1) * sway * 2), strand = curve([bx, 19], [bx + part, 27], [tip, 34]);
        const [sd, st] = onCurve(strand, 4.5, 2, x, y);
        if (sd > 0) v = sd < 0.8 ? 'k' : sd > 1.2 && Math.round(st * 16) % 4 === 2 ? 's' : 'a';
      }
      // the maw, gaping when it spits: black inside, a ring of teeth
      if (open) {
        const m = ((x - 36) / 9) ** 2 + ((y - 26) / 6) ** 2;
        if (m < 1) v = m > 0.55 && Math.round(x / 2) % 2 === 0 ? 's' : 'k';
      }
      // clawed hands gripping the rim
      const hx = 36 + 21 * side;
      if (((x - hx) / 7) ** 2 + ((y - 34) / 3) ** 2 < 1) v = 'a';
      if (y >= 35.5 && y < 39 && [-4, 0, 4].some(f => Math.abs(x - hx - f) < 1.2)) v = y > 38 ? 'k' : 'a';
      g[r][c] = v;
    }
    // outline: a shape's pixel next to nothing (left, right, above, below) turns black
    const out = g.map(row => row.slice());
    for (let r = 0; r < BH; r++) for (let c = 0; c < BW; c++) {
      if (g[r][c] === '.' || g[r][c] === 'k') continue;
      const empty = (rr, cc) => rr < 0 || rr >= BH || cc < 0 || cc >= BW || g[rr][cc] === '.';
      if (empty(r - 1, c) || empty(r + 1, c) || empty(r, c - 1) || empty(r, c + 1)) out[r][c] = 'k';
    }
    return out;
  }
  // The pit's broken rim: a black hole in the floor with shards round it.
  const PIT = (() => {
    const g = Array.from({ length: BH }, () => new Array(BW).fill('.'));
    for (let r = RIM; r < BH; r++) for (let c = 0; c < BW; c++) {
      const x = 2 * c + 1, y = r + 0.5, e = ((x - 36) / 33) ** 2 + ((y - 39.5) / 3) ** 2;
      if (e < 1 || (e < 1.35 && (c * 7 + r * 3) % 5 < 2)) g[r][c] = 'k';
    }
    return g;
  })();
  // The boss risen `sunk` rows short of the full height: the body slid down and hidden below the rim
  // (row RIM on), the pit always there, under the claws.
  function bossImage(open, step, sunk = 0) {
    const body = bossBody(open, step);
    return Array.from({ length: BH }, (_, r) => {
      const row = [];
      for (let c = 0; c < BW; c++) {
        const b = r - sunk >= 0 ? body[r - sunk][c] : '.';
        row.push(r < RIM ? b : sunk === 0 && b !== '.' && /a|s/.test(b) && r < RIM + 3 ? b : PIT[r][c] !== '.' ? PIT[r][c] : sunk === 0 ? b : '.');
      }
      return row.join('');
    });
  }
  // A 36 x 42 image as its 6 sprites, part 0-5 (left to right, then the lower row).
  const parts = rows => [0, 1].flatMap(b => [0, 1, 2].map(c => rows.slice(21 * b, 21 * b + 21).map(r => r.slice(12 * c, 12 * c + 12))));
  const BOSS = {
    idle0: bossImage(false, 0), idle1: bossImage(false, 1), spit: bossImage(true, 0),
    rise0: bossImage(false, 0, RIM), rise1: bossImage(false, 1, 27), rise2: bossImage(false, 0, 17), rise3: bossImage(false, 1, 8),
  };
  // Its spit, and the tentacle that bursts from the floor under the hero: the floor cracking first,
  // then the tentacle rising and lashing.
  const SPIT = ['....kkk.....', '...kaaak....', '..kaaasak...', '..kaaaaak...', '...kaaak....', '....kkk.....'];
  const GRASP = [
    ['............', '............', '....k..k....', '..k.kkk.k...', '...kk.kk.k..', '.k..kkk.....'],
    ['.....kk.....', '....kaak....', '....kask....', '...kaak.....', '...kaak.....', '..kkaakk.k..', '.k.kkkkkk...',
      '..k.kkk.k...'],
    ['...kk.......', '..kaak......', '..ksak......', '...kaak.....', '....kaak....', '....kask....', '....kaak....',
      '...kaak.....', '...kasak....', '...kaak.....', '..kaaak.....', '..kaaak.....', '.kkaaakkk...', 'k.kkkkkk.k..',
      '..k.kkk.k...'],
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
  for (const [view, top] of [['side', SIDE], ['front', FRONT], ['back', BACK]])
    for (const [step, coat] of Object.entries(COAT[view])) IMAGES[`hero_${view}_${step}`] = [...top, ...coat];
  IMAGES.hero_dead = DEAD;
  DROWNED.forEach((r, k) => { IMAGES['drowned' + k] = r; });
  SPAWN.forEach((r, k) => { IMAGES['spawn' + k] = r; });
  IMAGES.drowned_eyes = eyes(DROWNED[0], 5);
  IMAGES.spawn_eyes = eyes(SPAWN[0], 8);
  SPLAT.forEach((r, k) => { IMAGES['splat' + k] = r; });
  IMAGES.bullet = BULLET;
  for (const [pose, rows] of Object.entries(BOSS)) parts(rows).forEach((p, k) => { IMAGES[`boss_${pose}_${k}`] = p; });
  IMAGES.spit = SPIT;
  GRASP.forEach((r, k) => { IMAGES['grasp' + k] = r; });

  // Each image as 21 rows of 12 values (0 clear, 1 black, 2 own colour, 3 light red).
  const FRAMES = {};
  for (const [name, rows] of Object.entries(IMAGES)) {
    if (rows.length > 21 || rows.some(r => r.length !== 12)) throw new Error(`sprite ${name}: rows must be 12 wide, 21 at most`);
    const out = rows.map(r => Array.from(r, ch => ({ k: 1, a: 2, s: 3 }[ch] || 0)));
    while (out.length < 21) out.unshift(new Array(12).fill(0));
    FRAMES[name] = out;
  }
  return { COLORS, IMAGES, FRAMES, BOSS };
});
