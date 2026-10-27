/*
 * APEX level format: a text grid, one character per tile.
 *
 *   #        wall (tile 1)
 *   1-9      wall of that tile type
 *   . or ' ' open floor
 *   N E S W  open floor, where the player starts, facing that way
 *   G B $    open floor with an object on it: guard, barrel, treasure
 *   ; ...    comment line (the first one names the level)
 *
 * parse(text) returns { name, w, h, cells, start: { x, y, a }, objects: [{ type, x, y }] }, with
 * positions in 8.8 tiles (the centre of the square) and the angle in raycast units (0 east, 256 south).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.APEXLEVEL = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FACING = { E: 0, S: 256, W: 512, N: 768 };
  const OBJECTS = { G: 'guard', B: 'barrel', $: 'treasure' };

  function parse(text) {
    const lines = text.replace(/\r/g, '').split('\n');
    const comments = lines.filter(l => l.startsWith(';')), rows = lines.filter(l => !l.startsWith(';') && l.trim());
    const w = Math.max(...rows.map(r => r.length)), h = rows.length;
    const cells = new Uint8Array(w * h);
    let start = null;
    const objects = [];
    rows.forEach((r, y) => {
      for (let x = 0; x < w; x++) {
        const ch = r[x] || ' ';
        if (ch === '#') cells[y * w + x] = 1;
        else if (ch >= '1' && ch <= '9') cells[y * w + x] = +ch;
        else if (ch in FACING) start = { x: x * 256 + 128, y: y * 256 + 128, a: FACING[ch] };
        else if (ch in OBJECTS) objects.push({ type: OBJECTS[ch], x: x * 256 + 128, y: y * 256 + 128 });
        else if (ch !== '.' && ch !== ' ') throw new Error(`level: unknown tile '${ch}' at ${x},${y}`);
      }
    });
    if (!start) throw new Error('level: no player start (N, E, S or W)');
    return { name: comments.length ? comments[0].slice(1).trim() : 'untitled', w, h, cells, start, objects };
  }

  return { parse, FACING, OBJECTS };
});
