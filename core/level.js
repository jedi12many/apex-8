/*
 * APEX level format: a text grid, one character per tile.
 *
 *   #        wall (tile 1)
 *   1-9      wall of that tile type
 *   . or ' ' open floor
 *   N E S W  open floor, where the player starts, facing that way
 *   ; ...    comment line (the first one names the level)
 *
 * parse(text) returns { name, w, h, cells, start: { x, y, a } }, with the start in 8.8 tiles (the
 * centre of its square) and the angle in raycast units (0 east, 256 south).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.APEXLEVEL = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FACING = { E: 0, S: 256, W: 512, N: 768 };

  function parse(text) {
    const lines = text.replace(/\r/g, '').split('\n');
    const comments = lines.filter(l => l.startsWith(';')), rows = lines.filter(l => !l.startsWith(';') && l.trim());
    const w = Math.max(...rows.map(r => r.length)), h = rows.length;
    const cells = new Uint8Array(w * h);
    let start = null;
    rows.forEach((r, y) => {
      for (let x = 0; x < w; x++) {
        const ch = r[x] || ' ';
        if (ch === '#') cells[y * w + x] = 1;
        else if (ch >= '1' && ch <= '9') cells[y * w + x] = +ch;
        else if (ch in FACING) start = { x: x * 256 + 128, y: y * 256 + 128, a: FACING[ch] };
        else if (ch !== '.' && ch !== ' ') throw new Error(`level: unknown tile '${ch}' at ${x},${y}`);
      }
    });
    if (!start) throw new Error('level: no player start (N, E, S or W)');
    return { name: comments.length ? comments[0].slice(1).trim() : 'untitled', w, h, cells, start };
  }

  return { parse, FACING };
});
