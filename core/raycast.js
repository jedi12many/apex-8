/*
 * APEX raycaster — the reference implementation every platform port is checked against.
 *
 * It uses integer maths only, the way an 8-bit CPU would run it, so a 6502 port that uses the same
 * tables gets exactly the same numbers:
 *   - positions are 8.8 fixed point in tiles (256 = one tile)
 *   - angles run 0-1023 for a full turn: 0 east, 256 south (y grows downward, as in the map text)
 *   - per ray, a DDA walk over the grid using sec() tables, then a fisheye correction per column
 *
 * makeCaster(opts) builds the tables for one view (ray count, field of view, wall scale); cast()
 * returns one { halfH, side, tile, dist, u } per ray, where u (0-255) is where along the wall face the ray
 * hit, left to right as seen. Platforms turn those into pixels their own way.
 *
 * With opts.interpolate, only the even rays (and the last) are cast. An odd ray whose neighbours hit
 * the same face of the same tile takes the mean of their heights and distances instead: on a flat wall
 * 1/distance, and so the wall height, changes linearly across the screen. Any other odd ray is cast.
 *
 * With opts.fog, a wall whose half height would be fog pixels or less is too far away to see: its ray
 * returns halfH 0, dist 0xFFFF and no tile. FOG_PERP is the nearest distance that happens at, and
 * project() leaves out objects that far away or more. A port can stop each ray's walk there.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.APEXRAY = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ANG = 1024, QUAD = 256, ONE = 256, MAX16 = 0xffff;
  const rad = a => (a * 2 * Math.PI) / ANG;

  // SEC[k] = 1/cos(k) for k in 0..256 (one quadrant), 8.8, saturating at $FFFF.
  const SEC = Array.from({ length: QUAD + 1 }, (_, k) => {
    const c = Math.cos(rad(k));
    return c < ONE / MAX16 ? MAX16 : Math.min(MAX16, Math.round(ONE / c));
  });
  // SIN[k] for k in 0..256, 0.8 (256 = 1.0), for moving the player.
  const SIN = Array.from({ length: QUAD + 1 }, (_, k) => Math.round(Math.sin(rad(k)) * ONE));

  function sin(a) {
    a &= ANG - 1;
    const q = a >> 8, k = a & 255;
    const v = q & 1 ? SIN[QUAD - k] : SIN[k];
    return q & 2 ? -v : v;
  }
  const cos = a => sin(a + QUAD);

  // opts: rays (columns), fov (degrees), scale (half-wall height in pixels at one tile), maxH (half the
  // view height in pixels), even (round half-heights down to even pixels), maxSteps (DDA limit),
  // interpolate (cast every other ray where it can, see above), fog (see above; 0 for none).
  function makeCaster(opts = {}) {
    const o = Object.assign({ rays: 80, fov: 66, scale: 100, maxH: 80, even: true, maxSteps: 64, interpolate: false, fog: 0 }, opts);
    const t = Math.tan((o.fov * Math.PI) / 360);
    // Each ray's angle relative to the view direction: evenly spaced on the screen plane, not in angle.
    const COL_ANGLE = Array.from({ length: o.rays }, (_, c) =>
      Math.round((Math.atan((((c + 0.5) * 2) / o.rays - 1) * t) * ANG) / (2 * Math.PI)));
    // Fisheye correction: cos of that angle, 0.8 fixed, capped at 255.
    const COL_COS = COL_ANGLE.map(a => Math.min(255, Math.round(Math.cos(rad(a)) * ONE)));
    const SCALE = o.scale * ONE;
    // halfH <= fog exactly when perp > SCALE / (fog + 2), as halfH is rounded down to even.
    const FOG_PERP = o.fog ? Math.floor(SCALE / (o.fog + 2)) + 1 : Infinity;

    // map: { w, h, cells: Uint8Array, 0 = open, anything else = a wall tile }; outside the map is solid.
    function cast(map, px, py, pa) {
      const out = new Array(o.rays);
      const solid = (x, y) => (x < 0 || y < 0 || x >= map.w || y >= map.h ? 1 : map.cells[y * map.w + x]);
      const ray = c => {
        const a = (pa + COL_ANGLE[c]) & (ANG - 1), q = a >> 8, k = a & 255;
        const secX = q & 1 ? SEC[QUAD - k] : SEC[k], secY = q & 1 ? SEC[k] : SEC[QUAD - k];
        const stepX = q === 0 || q === 3 ? 1 : -1, stepY = q < 2 ? 1 : -1;
        let mapX = px >> 8, mapY = py >> 8;
        const fx = px & 255, fy = py & 255;
        let sideX = Math.min(MAX16, ((stepX > 0 ? ONE - fx : fx) * secX) >> 8);
        let sideY = Math.min(MAX16, ((stepY > 0 ? ONE - fy : fy) * secY) >> 8);
        let side = 0, dist = 0, tile = 0;
        for (let n = 0; n < o.maxSteps; n++) {
          if (sideX < sideY) { mapX += stepX; side = 0; dist = sideX; sideX = Math.min(MAX16, sideX + secX); }
          else { mapY += stepY; side = 1; dist = sideY; sideY = Math.min(MAX16, sideY + secY); }
          tile = solid(mapX, mapY);
          if (tile) break;
        }
        const perp = (dist * COL_COS[c]) >> 8;
        if (perp >= FOG_PERP) { out[c] = { halfH: 0, side: 0, tile: 0, dist: 0xffff, mapX: -1, mapY: -1, u: 0 }; return; }
        let halfH = perp ? Math.min(o.maxH, Math.floor(SCALE / perp)) : o.maxH;
        if (o.even) halfH &= ~1;
        // u: where along the wall face the ray hit, 0-255 across one tile, left to right as seen.
        const along = side === 0 ? py + ((dist * sin(a)) >> 8) : px + ((dist * cos(a)) >> 8);
        const u = side === 0 ? (stepX > 0 ? along & 255 : 255 - (along & 255)) : (stepY > 0 ? 255 - (along & 255) : along & 255);
        out[c] = { halfH, side, tile, dist: perp, mapX, mapY, u };
      };
      if (!o.interpolate) {
        for (let c = 0; c < o.rays; c++) ray(c);
        return out;
      }
      for (let c = 0; c < o.rays; c += 2) ray(c);
      if (!(o.rays & 1)) ray(o.rays - 1);
      for (let c = 1; c < o.rays - 1; c += 2) {
        const l = out[c - 1], r = out[c + 1];
        if (l.mapX !== r.mapX || l.mapY !== r.mapY || l.side !== r.side) { ray(c); continue; }
        let halfH = (l.halfH + r.halfH) >> 1;
        if (o.even) halfH &= ~1;
        const u = (l.u + r.u) >> 1;
        out[c] = { halfH, side: l.side, tile: l.tile, dist: (l.dist + r.dist) >> 1, mapX: l.mapX, mapY: l.mapY, u, interpolated: true };
      }
      return out;
    }

    // Where a point object at (x, y) appears: depth along the view (8.8 tiles, comparable with a ray's
    // dist), col its screen position in ray columns (8.8, 0 = left edge) and halfH the half height of a
    // wall at that depth, uncapped. Null when it is behind the player or closer than an eighth of a tile.
    const FOCAL = Math.round(((o.rays / 2) * ONE) / t);
    function project(p, x, y) {
      const dx = x - p.x, dy = y - p.y, c = cos(p.a), s = sin(p.a);
      const depth = (dx * c + dy * s) >> 8, lat = (dy * c - dx * s) >> 8;
      if (depth < 32 || depth >= FOG_PERP) return null;
      return { depth, col: (o.rays / 2) * ONE + Math.floor((lat * FOCAL) / depth), halfH: Math.floor(SCALE / depth) };
    }

    return { opts: o, COL_ANGLE, COL_COS, FOG_PERP, cast, project };
  }

  // Move by `speed` (8.8 tiles) along angle a, sliding along walls; keeps `radius` (8.8) clear of them.
  function move(map, p, a, speed, radius = 64) {
    const solid = (x, y) => x < 0 || y < 0 || x >= map.w || y >= map.h || map.cells[y * map.w + x];
    const dx = (cos(a) * speed) >> 8, dy = (sin(a) * speed) >> 8;
    const clear = (x, y) => !solid((x - radius) >> 8, (y - radius) >> 8) && !solid((x + radius) >> 8, (y - radius) >> 8) &&
      !solid((x - radius) >> 8, (y + radius) >> 8) && !solid((x + radius) >> 8, (y + radius) >> 8);
    if (clear(p.x + dx, p.y)) p.x += dx;
    if (clear(p.x, p.y + dy)) p.y += dy;
    return p;
  }

  return { ANG, QUAD, ONE, SEC, SIN, sin, cos, makeCaster, move };
});
