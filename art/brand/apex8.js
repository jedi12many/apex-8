// The APEX-8 badge, the engine's mark for title screens, drawn for the C64's multicolor modes after
// apex8-source.png: a striped sun setting behind a snow-capped mountain, lit on its left, over APEX-8
// in bold white with a blue shadow, the 8 in yellow and light red. 40 fat pixels by 48 rows (10 x 6 cells) on
// black, its colours kept to 3 a 4 x 8 cell (black aside) so it drops into a multicolor bitmap or
// character set as it is: the sun's bands change colour on cell rows, the snow stays above row 16 and
// the mountain's dark side below it.
//
// badge() returns { w, h, px }: px[y * w + x] a C64 colour (0 black).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.APEX8 = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const W = 40, H = 48, MID = 40; // MID: the middle, in real pixels
  const BLACK = 0, WHITE = 1, RED = 2, BLUE = 6, YELLOW = 7, LIGHT_RED = 10, LIGHT_BLUE = 14;
  // Bold 5 x 5 letters (the dash 3 wide), each row drawn twice.
  const GLYPHS = {
    A: ['01110', '11011', '11111', '11011', '11011'], P: ['11110', '11011', '11110', '11000', '11000'],
    E: ['11111', '11000', '11110', '11000', '11111'], X: ['11011', '11011', '01110', '11011', '11011'],
    '-': ['000', '000', '111', '000', '000'], 8: ['01110', '11011', '01110', '11011', '01110'],
  };
  const TEXT = [['A', 4], ['P', 10], ['E', 16], ['X', 22], ['-', 28], ['8', 32]], TEXT_TOP = 34;

  function badge() {
    const px = new Uint8Array(W * H);
    const set = (x, y, c) => { if (x >= 0 && x < W && y >= 0 && y < H) px[y * W + x] = c; };
    // the mountain (in real pixels, a fat pixel 2 wide): its apex at the middle of row 3, its foot
    // on row 31
    const mountain = (X, y) => y >= 3 && y <= 31 && Math.abs(X - MID) < (y - 3) * 1.3;
    for (let y = 0; y < 32; y++) for (let x = 0; x < W; x++) {
      const X = 2 * x + 1;
      if (mountain(X, y)) {
        const edge = !mountain(X - 2, y) || !mountain(X + 2, y) || !mountain(X, y - 1);
        let c;
        const snowLine = 12 + ((x >> 1) & 1 ? 2 : 0) + (x & 4 ? 1 : 0);
        if (y < Math.min(15, snowLine)) c = WHITE;
        else if (X < MID || y < 16) c = (y >= 16 && ((X + 2 * y) % 13 === 0 || (X + 2 * y) % 13 === 1)) ? BLUE : LIGHT_BLUE;
        else c = (X - 2 * y) % 11 === 0 && y > 18 ? LIGHT_BLUE : BLUE;
        set(x, y, edge ? BLACK : c);
        continue;
      }
      // the sun behind it: a half disc in bands, striped with black lower down
      const d = Math.hypot(X - MID, (y + 0.5 - 26) * 1.2);
      if (d < 31 && y < 26 && !(y >= 9 && y % 4 === 3)) set(x, y, y < 8 ? YELLOW : y < 16 ? LIGHT_RED : RED);
    }
    // APEX-8, shadowed down and right in blue
    for (const [ch, left] of TEXT) {
      const rows = GLYPHS[ch];
      for (const pass of [0, 1]) rows.forEach((r, y) => [...r].forEach((v, x) => {
        if (v !== '1') return;
        for (const dy of [0, 1]) {
          const X = left + x + (pass ? 0 : 1), Y = TEXT_TOP + 2 * y + dy + (pass ? 0 : 1);
          const c = pass === 0 ? BLUE : ch === '8' ? (y < 2 || (y === 2 && dy === 0) ? YELLOW : LIGHT_RED) : ch === '-' ? LIGHT_BLUE : WHITE;
          set(X, Y, c);
        }
      }));
    }
    // every cell within the multicolor limit
    for (let cy = 0; cy < H / 8; cy++) for (let cx = 0; cx < W / 4; cx++) {
      const used = new Set();
      for (let y = 8 * cy; y < 8 * cy + 8; y++) for (let x = 4 * cx; x < 4 * cx + 4; x++) if (px[y * W + x]) used.add(px[y * W + x]);
      if (used.size > 3) throw new Error(`APEX-8 badge: cell ${cx},${cy} has ${used.size} colours`);
    }
    return { w: W, h: H, px };
  }

  return { W, H, badge };
});
