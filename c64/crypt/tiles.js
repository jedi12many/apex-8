/*
 * The Drowned Crypt's drawn tiles, for the iso view's drawn-tile mode (artShade in c64/iso/view.js):
 * fat pixel grids, one character per fat pixel:
 *   0 black ($D021: joints, deep shadow)    1 white ($D022: flames, wet glints)
 *   2 dark grey ($D023: mortar, slime)      3 lit stone (colour RAM: the torchlight's colour)
 *   . outside the shape (never shows)
 * floor and cracked are the floor diamond; wall and torch a wall block's top diamond and its two faces
 * (left lit, right in shade), each face 8 fat pixels across and 16 rows down from its top edge. The
 * light thins lit stone (3) away from the hero, so stone drawn in 3 fades into the dark while mortar
 * (2) and flames (1) stay.
 *
 * Works in Node and in the browser (global APEXCRYPTTILES).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.APEXCRYPTTILES = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const floor = [
    '................',
    '.......33.......',
    '......3333......',
    '.....333333.....',
    '....33333333....',
    '...3333233333...',
    '..333333333333..',
    '.33333333333333.',
    '.33333333332333.',
    '..233333333330..',
    '...2333333330...',
    '....23333330....',
    '.....233330.....',
    '......2330......',
    '.......20.......',
    '................',
  ];
  // the same slab, split by a crack, with a puddle glinting in it
  const cracked = [
    '................',
    '.......33.......',
    '......3333......',
    '.....333333.....',
    '....33330333....',
    '...3333303333...',
    '..333330333333..',
    '.33333302333333.',
    '.33322330333333.',
    '..222123303330..',
    '...2212330330...',
    '....22333030....',
    '.....233330.....',
    '......2330......',
    '.......20.......',
    '................',
  ];
  // a capstone in dark stone, its far edges catching the light
  const top = [
    '................',
    '.......33.......',
    '......3223......',
    '.....322223.....',
    '....32222223....',
    '...3222232222...',
    '..322222222222..',
    '.32222222222222.',
    '.22222222222222.',
    '..222222322222..',
    '...2222222222...',
    '....22222222....',
    '.....222222.....',
    '......2222......',
    '.......22.......',
    '................',
  ];
  // two courses of blocks, black joints, slime dripping down the upper one
  const left = [
    '33333333',
    '33302333',
    '33302333',
    '33302333',
    '32302333',
    '33302323',
    '33302333',
    '00000000',
    '33333333',
    '02333333',
    '02333233',
    '02333333',
    '02323333',
    '02333333',
    '02333333',
    '00000000',
  ];
  // the shaded face: the same blocks in dark grey, a little lit stone on their top edges
  const shade = rows => rows.map((r, k) => Array.from(r, (v, c) => (v !== '3' ? v : k === 0 || k === 8 ? ((c & 1) ? '2' : '3') : '2')).join(''));
  const right = shade(left);
  // a torch in an iron bracket on each face
  const withTorch = rows => rows.map((r, k) => {
    const put = { 1: '...1....', 2: '..11....', 3: '..111...', 4: '..11....', 5: '..00....', 6: '..00....', 7: '.2002...' }[k];
    return put ? Array.from(r, (v, c) => (put[c] === '.' ? v : put[c])).join('') : r;
  });

  return {
    floor, cracked,
    wall: { top, left, right },
    torch: { top, left: withTorch(left), right: withTorch(right) },
  };
});
