// Builds the APEX-8 disk for a C64 (or a C64 Ultimate): a 1581 disk image (D81: everything fits, where
// a 1541 D64 would not) holding every program in c64/out, behind a BASIC menu that comes first, so
// LOAD"*",8 then RUN shows it. A key loads a program, which runs at once (BASIC chains it); a reset
// comes back.
//
//   node c64/disk.js <path to VICE folder>
//
// Writes c64/out/apex-8.d81. Uses VICE's petcat (to tokenise the menu) and c1541 (to make the image);
// build the programs first.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');

const OUT = path.join(__dirname, 'out');
// [key, file on disk, what it is, PRG in c64/out]
const PROGRAMS = [
  ['1', 'raycaster', 'RAYCASTER: THE CELL BLOCK', 'apex.prg'],
  ['2', 'platformer', 'PLATFORMER: GREEN HILLS', 'side.prg'],
  ['3', 'dungeon', 'DUNGEON: THE CRYPT', 'iso.prg'],
  ['4', 'shooter', 'SHOOTER: THE DREADNOUGHT', 'shmup.prg'],
  ['5', 'shooter brick', 'SHOOTER IN THE BRICK LOOK', 'shmup-brick.prg'],
  ['6', 'music shooter', 'MUSIC: THE DREADNOUGHT', 'sound.prg'],
  ['7', 'music crypt', 'MUSIC: THE DROWNED CRYPT', 'sound-crypt.prg'],
  ['8', 'music hills', 'MUSIC: GREEN HILLS', 'sound-hills.prg'],
  ['9', 'music cell', 'MUSIC: THE CELL BLOCK', 'sound-cell.prg'],
  ['0', 'apex-8', 'THE APEX-8 SPLASH', 'picture.prg'],
  ['s', 'story', 'STORY MODE: THE MOUNTAIN', 'story.prg'],
];

// The menu, in BASIC (petcat's text form: {clr} and the like are control codes).
const MENU = [
  '10 poke53280,0:poke53281,0:print"{clr}{wht}"',
  '20 print"{down}        {yel}apex-8{wht} for the c64"',
  '30 print"{down}  {lblu}engines and demos, made with apex-8{wht}"',
  '40 print"{down}"',
  ...PROGRAMS.map(([key, , label], k) => `${50 + 10 * k} print"   ${key}  ${label.toLowerCase()}"`),
  `${50 + 10 * PROGRAMS.length} print"{down}  {gry2}press a number. reset for the menu.{wht}"`,
  '200 geta$:ifa$=""then200',
  ...PROGRAMS.map(([key, file], k) => `${210 + 10 * k} ifa$="${key}"thenprint"{down}  loading...":load"${file}",8`),
  '900 goto200',
];

const vice = process.argv[2];
if (!vice) { console.error('usage: node c64/disk.js <VICE folder>'); process.exit(2); }
const tool = name => ['.exe', ''].map(e => path.join(vice, 'bin', name + e)).find(f => fs.existsSync(f));
const petcat = tool('petcat'), c1541 = tool('c1541');
if (!petcat || !c1541) { console.error(`petcat or c1541 not found under ${vice}/bin`); process.exit(2); }
for (const [, , , prg] of PROGRAMS) if (!fs.existsSync(path.join(OUT, prg))) throw new Error(`c64/out/${prg} missing: build it first`);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-disk-'));
fs.writeFileSync(path.join(dir, 'menu.txt'), MENU.join('\n') + '\n');
const run = (exe, args) => {
  const r = spawnSync(exe, args, { encoding: 'utf8' });
  if (r.status) throw new Error(`${path.basename(exe)} failed: ${r.stdout}${r.stderr}`);
  return r;
};
run(petcat, ['-w2', '-o', path.join(dir, 'menu.prg'), '--', path.join(dir, 'menu.txt')]);

const image = path.join(OUT, 'apex-8.d81');
try { fs.unlinkSync(image); } catch (e) { /* not there yet */ }
const args = ['-format', 'apex-8,a8', 'd81', image, '-write', path.join(dir, 'menu.prg'), 'menu'];
for (const [, file, , prg] of PROGRAMS) args.push('-write', path.join(OUT, prg), file);
run(c1541, args);
fs.rmSync(dir, { recursive: true, force: true });
const list = run(c1541, ['-attach', image, '-list']).stdout.trim().split('\n');
console.log(`c64/out/apex-8.d81:\n${list.map(l => '  ' + l).join('\n')}`);
