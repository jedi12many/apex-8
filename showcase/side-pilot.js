// An autopilot for the platformer: run right, jumping at a wall or a pit ahead and holding jump while
// rising; at the end of the level, stop. Used by the video (showcase/side.js) and the C64 test.
//
// inputs(level, n) plays n ticks from the start and returns { inputs, p, cam } after them.
const PLAT = require('../core/platform.js');

function autopilot(level, p) {
  const B = PLAT.BLOCK, front = p.x + PLAT.PHYS.width, feet = p.y + PLAT.PHYS.height;
  if (Math.floor(p.x / B) >= level.w - 3) return 0;
  const solid = (x, y) => PLAT.solidAt(level, Math.floor(x / B), Math.floor(y / B));
  // a pit: nothing under the next step for 3 blocks down (a ledge with ground below is walked off)
  const pit = [0, 1, 2].every(d => !solid(front + 2 * 16, feet + 16 + d * B)), wall = solid(front + 10 * 16, feet - 16) || solid(front + 10 * 16, p.y + 16);
  if (p.ground) return pit || wall ? 6 : 2;
  return p.vy < 0 ? 6 : 2;
}

function inputs(level, n) {
  const p = PLAT.player(level), list = [];
  let cam = PLAT.follow(level, p, 0);
  for (let k = 0; k < n; k++) {
    const b = autopilot(level, p);
    list.push(b);
    PLAT.tick(level, p, b);
    cam = PLAT.follow(level, p, cam);
  }
  return { inputs: list, p, cam };
}

module.exports = { autopilot, inputs };
