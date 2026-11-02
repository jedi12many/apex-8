// Checks the Drowned Crypt's stealth rules (core/crypt.js with { stealth: true }, as The Investigator
// plays): the cigarette, torchlight, creatures that notice only by light, the tentacle, darkvision.
//
//   node test/crypt-stealth-check.js
const A = require('path').join(__dirname, '..') + '/', fs = require('fs'), assert = require('assert');
const G = require(A + 'core/crypt.js'), V = require(A + 'c64/crypt/view.js');
const M = V.withTiles(G.parse(fs.readFileSync(A + 'levels/iso/c1.txt', 'utf8')));
const fresh = () => { const g = G.game(M, { stealth: true }); G.tick(M, g, 16); G.tick(M, g, 0); return g; };
const near = (g, c, dx) => { g.hero.x = c.x + dx; g.hero.y = c.y; };
const spawn = g => g.creatures.find(c => c.kind === G.SPAWN && !M.light[(c.y >> 8) * M.w + (c.x >> 8)]);
let g = fresh();
assert.strictEqual(g.mode, G.PLAY); assert.strictEqual(g.lit, true); assert.strictEqual(g.dark, false);
G.tick(M, g, 32); assert.strictEqual(g.hero.cig, false); assert.strictEqual(g.dark, true, 'start tile unlit');
G.tick(M, g, 32); assert.strictEqual(g.hero.cig, false, 'held: no toggle');
G.tick(M, g, 0); G.tick(M, g, 32); assert.strictEqual(g.hero.cig, true); assert(g.events.includes('light'));
// a spawn out of torchlight: in the dark it doesn't notice him; lashed unaware, it dies outright
g = fresh(); G.tick(M, g, 32); let c = spawn(g); near(g, c, 400);
for (let i = 0; i < 20; i++) G.tick(M, g, 0);
assert.strictEqual(g.dark, true); assert.strictEqual(c.awake, false, 'unseen in the dark');
const f = V.frame(M, g); assert(f.sprites.some(s => s.shape && s.color === V.SENSED.evil), 'spawn sensed');
near(g, c, 180); G.tick(M, g, 16);
assert(g.events.includes('lash') && g.events.includes('kill'), 'one-shot unaware'); assert.strictEqual(c.hp, 0);
// lit, it sees him and comes; lashed while it sees him, it takes one hit
g = fresh(); c = spawn(g); near(g, c, 400); G.tick(M, g, 0);
assert(c.awake && c.sees, 'sees him in the light');
near(g, c, 180); G.tick(M, g, 0); G.tick(M, g, 16);
assert(g.events.includes('lash') && g.events.includes('hit')); assert.strictEqual(c.hp, G.HP[G.SPAWN] - 1);
// goes dark: it loses him and goes to where it saw him last
g = fresh(); c = spawn(g); near(g, c, 600); G.tick(M, g, 0); assert(c.sees);
const lx = c.gx; G.tick(M, g, 32); g.hero.y += 300;
for (let i = 0; i < 200; i++) G.tick(M, g, 0);
assert(!c.sees && Math.abs(c.x - lx) < 64, 'waits where it saw him');
// a shot in the dark gives him away
g = fresh(); G.tick(M, g, 32); c = spawn(g); near(g, c, 600); g.hero.aim = 4;
G.tick(M, g, 0); assert(!c.awake); G.tick(M, g, 16); assert(c.awake, 'muzzle flash');
// drowned ones are undead: darkvision doesn't show them
g = fresh(); G.tick(M, g, 32); const d = g.creatures.find(c => c.kind === G.DROWNED && !M.light[(c.y >> 8) * M.w + (c.x >> 8)]);
near(g, d, 400); G.tick(M, g, 0);
assert.strictEqual(V.frame(M, g).sprites.filter(s => s.shape).length, 1, 'only the hero');
// near a torch the darkvision is blinded
g = fresh(); G.tick(M, g, 32); g.hero.y = 2 * 256 + 128; G.tick(M, g, 0); assert.strictEqual(g.dark, false, 'torchlight');
console.log('stealth: all checks pass');
