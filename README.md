# APEX-8

Game engines and tools for 8-bit machines, starting with the Commodore 64:

- **a first-person raycaster**: the Cell Block (E1M1) in APEXSCII's raycast characters, with a pistol, guards to shoot, treasure and music
- **a parallax platformer**: Green Hills, with coins, beetles, a flag and music
- **an isometric dungeon**: the Crypt, with a torchlight that follows the hero, and the Drowned Crypt, a small action game built on it
- **a vertical shoot-'em-up**: the Dreadnought, with a sprite multiplexer, a status bar and music
- **a story mode**: scenes told over a slowly panning picture, with typed text and choices (the Mountain)

Each engine has a JavaScript reference that defines every frame, and a 6502 engine that is checked against it pixel for pixel in VICE, timing included. Alongside them:

- **the kit**: the start-up, the multiplexer, the test scripts and profiler
- **the SID driver**: music and effects, register-exact with its reference
- **a SID emulation**: so the browser versions play the same sound
- **converters**: pictures to C64 bitmaps, tiles and sprites from drawn art
- **the tests**: run everything in VICE

**Play them in the browser: [jedi12many.github.io/apex-8](https://jedi12many.github.io/apex-8/)**, the references with their sound, and the C64 disk to download (see [The demo site](#the-demo-site)).

The C64 engines draw with the [APEXSCII](https://github.com/jedi12many/apexscii) character sets, included as a submodule.

```bash
git clone --recurse-submodules https://github.com/jedi12many/apex-8.git
```

Made something with APEX-8? Put the badge on it: see [The APEX-8 badge](#the-apex-8-badge) and [BRAND.md](BRAND.md).

## The raycaster in brief

Every platform shares:
- the level format
- the levels
- one reference raycaster

Each port draws in its own way, and is tested pixel for pixel against the reference.

To play on a C64 or in VICE, load `c64/out/apex.prg` with `LOAD"*",8,1`, then `RUN`. Use a joystick in port 2, or W and S to walk, A and D to turn and Space to fire. `showcase/out/c64-e1m1.mp4` is a recording of it running in VICE (before the game was added). `web/ray.html` plays the reference in a browser.

**The game** (`core/raygame.js`): the pistol fires once every 16 ticks and flashes for 6. A shot hits the nearest guard over the middle of the screen, if it is nearer than the wall the middle ray meets; the guard shows white for 12 ticks and is gone. Walking within 3/8 of a tile of treasure picks it up. Guards are worth 50, treasure 100, and the score shows in the panel. Treasure doesn't block the way; guards and barrels do, until a guard is gone. `sound/cell.js` is its music: an original, brooding piece in A minor, a pulsing drone, a heartbeat kick and an uneasy lead, with a shot, a guard's death and a pickup as effects.

## Layout

| Path | What it is |
|------|------------|
| `core/raycast.js` | The reference raycaster. Integer maths only, so ports can match it value for value. |
| `core/level.js` | The level format |
| `core/raygame.js` | The game: the pistol, guards that die when shot, treasure and the score, tick by tick |
| `levels/` | Levels, as text grids |
| `c64/view.js` | The C64 view: 80 rays drawn with APEXSCII glyphs, plus a ROM-font status panel |
| `c64/sprites.js` | Guards, barrels and treasure as hardware sprites, scaled and hidden behind walls |
| `c64/apex.s`, `c64/sprites.s`, `c64/raygame.s` | The C64 engine in 6502 assembly, and its game |
| `sound/cell.js` | The Cell Block's music and effects |
| `web/ray.html` | The reference, playable in a browser, with its sound |
| `c64/gen.js`, `c64/build.js` | Generate the engine's tables from the reference, then assemble it with cc65 |
| `c64/out/apex.prg` | The engine with E1M1, ready to run |
| `showcase/walk.js` | A walk through E1M1 rendered by the reference, as videos, runnable stills and a contact sheet |
| `showcase/c64-video.js` | Records the real engine running in VICE |
| `test/vice-check.js` | Runs the reference stills in VICE and checks every pixel |
| `test/c64-check.js` | Runs frames drawn by the 6502 engine in VICE and checks every pixel against the reference |
| `test/c64-bench.js` | Measures the engine's frame rate in VICE |
| `apexscii/` | The character sets (submodule) |

Platforms get their own folder: `c64/` now, and others as they're added.

## The raycaster

`core/raycast.js` uses only integer maths that an 8-bit CPU can do with tables:
- **Positions** are 8.8 fixed point in tiles, so 256 is one tile.
- **Angles** run 0–1023 for a full turn: 0 is east and 256 is south, because y grows down the map.
- **Each ray** walks the grid as a DDA:
  - its step lengths come from a quarter-wave `SEC` table (1/cos, 8.8)
  - it stops at the first wall
  - its distance gets a per-column fisheye correction
- **Half wall height** is `scale × 256 / distance`, capped at half the view.

Rays are spaced evenly across the screen, not in angle, so walls stay straight. With `angleStep`, they are that many angle units apart instead (the field of view is `rays × angleStep`). Turning by a multiple of it then shifts the rays, so a port can keep the ones it has. Walls bow a little at the sides, and `project()` places objects by angle, through the table `ATAN_COL`.

With `interpolate`, only the even rays and the last are cast. An odd ray whose two neighbours hit the same face of the same tile takes the mean of their heights and distances. On a flat wall, 1/distance changes linearly across the screen, so the mean is within 2 pixels of a cast. Any other odd ray is cast. Along the E1M1 walk this casts 47.5 of the 80 rays a frame, and about 3 rays a frame differ from a full cast, by 2 pixels.

With `interpolate: 4`, which the C64 view uses, only every fourth ray and the last two are cast at first. Each ray 2 on from a multiple of 4 is filled the same way from the rays 2 either side, or cast, and then the odd rays as before. Along the walk this casts 30.6 rays a frame instead of 45.4. About 6 rays a frame differ from a full cast, against 3 with every other ray, and on average 2.7 of the 40 screen columns differ from what every other ray gives.

With `fog`, a wall whose half height would be `fog` pixels or less is too far away to see. Its ray returns no wall (`halfH` 0, `dist` 0xFFFF), and `project()` leaves out objects at that depth or more. `FOG_PERP` is the nearest distance where that happens, so a port can stop each ray's walk there.

`makeCaster({ rays, fov, angleStep, scale, maxH, interpolate, fog })` builds the tables for one view. `cast(map, x, y, angle)` returns one result per ray:
- `halfH`: the half wall height
- `side`: 0 when the ray hits an east/west face, 1 for north/south
- `tile`: the wall type
- `dist`: the corrected distance

`project(player, x, y)` places a point object for the same view. It returns:
- `depth`: comparable with a ray's `dist`
- `col`: the screen position in ray columns, 8.8
- `halfH`: the half height of a wall at that depth

`move()` moves the player, sliding along walls.

## Levels

Levels are text files with one character per tile:

| Character | Tile |
|-----------|------|
| `#` | wall |
| `1`–`9` | a wall of that type |
| `.` or a space | floor |
| `N`, `E`, `S`, `W` | the player's start, facing that way |
| `G`, `B`, `$` | floor with a guard, a barrel or treasure on it |

Lines starting with `;` are comments, and the first comment names the level. See `levels/e1m1.txt`.

## C64 view

- **Layout:**
  - the view is 320×160 on rows 0–19, with 80 rays, two per character column, 2 angle units apart: a 56° view at scale 120
  - rows 20–24 are a status panel in the ROM font, shown through APEXSCII's raster split
  - the engine shows 38 columns, so the border hides the outer 7 and 9 pixels
- **Drawing:**
  - each ray's half height becomes a 9-state value per cell (empty, or wall shade A or B at 2/4/6/8 pixels)
  - the two rays in a column pick the screen code `$40 + 9 × left + right` above the horizon, and `$91 + …` below it
  - the bottom half mirrors the top half, so one height gives both
  - east/west faces are shade B, as in Wolfenstein
- **Bricks** (multicolor): each ray carries `u`, where along the face it hit. A wall is 4 courses of bricks, mirrored about the horizon: mortar lines at 80 − j and 80 + j (j is half the half height), a double line either side of the horizon, and staggered joints. Cells that are solid wall of one shade for both rays use 44 brick glyphs (22, and the same upside down) at the start of the set, leaving `$20` blank; the mortar is the other wall shade. In a brick cell the left ray decides the mortar line, which runs across the cell, and either ray can be a joint. `TEX_NEAR` can limit bricks to near walls. `c64/view.js` defines the rules, and the engine's tables are generated from them.
- **Multicolor colours:**
  - ceiling: `$D021`, shaded towards the horizon in the engine (see the gradient below)
  - floor: `$D022`, likewise
  - wall A: `$D023`
  - wall B: colour RAM
  
  The colour RAM is one constant value, so a frame only rewrites the 800 screen codes. Walls are foreground pixels, so hardware sprites with background priority hide behind them.

### Sprites

Guards, barrels and treasure are multicolor hardware sprites, so they keep their own colours and use no character slots. Each frame, `c64/sprites.js` does this for every object:
1. **Project** it with `project()`.
2. **Size** it: its height at that depth is rounded down to one of 36 fixed sizes, about 12% apart. Each size has an image scaled once from the source art. A type stops growing at the largest size that fits in 8 sprites: 144 pixels for a guard.
3. **Mask** it column by column wherever the ray in that column hit a wall nearer than the object. It disappears behind corners and doorways exactly, with no sprite-priority tricks. Rows outside the view are masked too.
4. **Cut** it into 24×21 sprites on a fixed grid. The grid starts at the first whole byte of columns that a sprite can reach at the left edge, and at the top of the view, so the C64 only copies and masks whole bytes. When X/Y expansion takes fewer sprites, it uses that, so a guard close up is 6 expanded sprites.

The nearest objects claim the VIC's 8 sprites first, and an object that doesn't fit whole waits.

Shared colours:
- `$D025`: black outlines
- `$D026`: light red skin and highlights

Each object's own colour is brown for guards, green for barrels and yellow for treasure.

```bash
node showcase/walk.js --rom "C:\path\to\GTK3VICE-3.10-win64\C64\chargen-901225-01.bin"
```

This writes the following to `showcase/out/`:
- `walk-mc.mp4` and `walk-hires.mp4`: 38 seconds at 25 fps; the multicolor one looks as the engine does, with its gradient and 38 columns
- ten runnable `.prg` stills
- `walk.png`

It needs ffmpeg. `--rom` shows the status panel in the real C64 ROM font.

## The C64 engine

`c64/apex.s` and `c64/sprites.s` are the engine in 6502 assembly, about 3.5KB of code. `c64/gen.js` generates all its tables from the reference: 1/cos, column angles, wall heights, screen codes, the status panel, and the objects' pre-scaled images. Because both use the same tables and the same integer steps, every ray, wall height and sprite comes out exactly the same.

Each frame:
1. **Controls and the game:** they run once for every 50 Hz tick since the last frame, so walking and turning speed don't depend on the frame rate. The player keeps 3/8 of a tile from walls and half a tile from a barrel's or guard's centre, on each axis, sliding along both; the test scripts check this against the same moves in JavaScript. Each tick also runs the game's timers, picks up treasure and fires (`c64/raygame.s`). A shot stops the ticks there (the rest wait for the next frame), so the frame is cast from the pose it was fired from, and after the objects are projected the engine finds the guard it hit from their depths, centres and heights and the middle ray's distance. If the player hasn't moved or turned and nothing else shown has changed, the screen showing is already right, and the frame stops here.
2. **Rays:** every fourth ray and the last two are cast, then each ray 2 on from a multiple of 4, then each odd ray, is interpolated or cast, as in the reference. When the player has only turned, ray c is the ray c + turn / 2 was, so what its walk found (distance, face, `u`) shifts across, and only its corrected distance and height are worked out again. Only the rays coming in at the edge are cast. A fog ray keeps a lower bound on its distance, and is cast again if a column with a nearer fog line needs it. The DDA keeps the map column in the Y register, so a step east or west is one `INY` or `DEY`. Multiplications use quarter-square tables, built at start-up at `$C000`. The distance from the player to the next grid line is the same for every ray in a quadrant, so its multiplies, the steps and the 1/cos tables are patched in once per quadrant, not per ray. Wall heights come from a table lookup instead of a division.
3. **Objects:** each is projected, using signed multiplies, a 32÷16 divide and the angle table, and sorted nearest first.
4. **Wait:** the engine waits until the last frame is showing.
5. **Draw:** the view is drawn into the hidden screen, 400 cells of two lookups each. The objects' masked tiles go into that screen's sprite blocks 1-7, along with the status numbers and the score. Sprite 0 is the pistol, expanded both ways at the bottom of the view, with a second image for the muzzle flash.
6. **Swap:** the screens swap. The IRQ at the top of the frame shows the new screen and loads its sprite registers from a shadow copy, so walls and sprites always change together. A last IRQ switches to the ROM font for the status panel.

**Gradient.** The ceiling and floor darken towards the horizon, with dithered stripes between shades. Raster IRQs, generated from the reference's `GRADIENT`, change `$D021` and `$D022` in the right border of the line before each change. Top glyphs never use the floor colour and bottom glyphs never the ceiling colour, so each register only has to be on time in its own half. Three things keep the writes in the border:
- **No bad lines:** no change falls on a bad line or the line after one.
- **A line between changes:** every wait starts before its line does.
- **38-column mode:** the border hides the leftmost 7 and rightmost 9 pixels. Polling jitter and the VIC's sprite fetches can land a write a cycle early or late, and those pixels are where it would show.

**Sound.** The bottom IRQ, after the split, plays the music and effects on the kit's SID driver 50 times a second (on a second SID if there is one), whatever the frame rate. The game starts effects with the IRQ held off. It costs about 5% of the CPU.

The write delay was found in VICE: 49 to 52 cycles draw every test frame exactly on PAL and NTSC, and the engine uses 50. The IRQs spin about 2,300 cycles of each 50 Hz frame, about 11% of the CPU.

**Fog.** The 16 lines each side of the horizon are black, and a wall that would fit inside them, more than about 7 tiles away, is left out: it looks like darkness. The engine starts each ray's side distances that far below $10000 (a per-ray table), so they overflow exactly at the fog. The walk already handles overflow, so the fog costs nothing per grid step: a ray ends when both directions have overflowed. Objects in the fog are skipped before their divide. A 24-line band was tried too: about 3% faster, but walls and guards vanished under 5 tiles away.

**Bricks.** At each hit the engine works out `u` with one more quarter-square multiply. After the cast, a pass gives each ray its joint (a table of ceil(u / 64)) and packs j, shade and joint into one byte. The draw looks up per-row tables for the left and right states, then a pair table for each half's screen code; as the bottom mirrors the top, one lookup serves both. The tables take 5KB, and the program is now 31KB.

**Speed.** On PAL, turning a quarter turn past the guards and walking along the first corridor:

| Build | Turning | Walking |
|-------|---------|---------|
| Before interpolation and per-quadrant set-up | 144,208 (6.8 fps) | |
| With them | 112,194 (8.8 fps) | |
| Plus the gradient | 124,553 (7.9 fps) | |
| Plus fog | 106,285 (9.3 fps) | |
| Plus bricks | 126,495 (7.8 fps) | 126,040 (7.8 fps) |
| Rays 2 angle units apart, kept when turning | 86,266 (11.4 fps) | 127,791 (7.7 fps) |
| Built with the kit (the same code, moved) | 86,346 (11.4 fps) | 127,503 (7.7 fps) |
| Every fourth ray cast first | 97,130 (10.1 fps) | 111,548 (8.8 fps) |
| With the game, the pistol's sprite and the music | 106,191 (9.3 fps) | 122,295 (8.1 fps) |

Casting every fourth ray first makes walking, the slowest case, 12% faster. Turning gets slower: a turn shifts the rays by 2 for each step of heading, so a ray that is a multiple of 4 often lands where a filled-in ray was last frame, which has nothing kept to reuse, and is cast afresh.

Bricks only on walls within about 3 tiles (`TEX_NEAR` 20) ran at 8.2 fps turning before ray reuse, and scale 160 (in proportion at 56°) at 9.4 turning and 7.4 walking. Neither was worth it.

With guards close by, projecting and cutting their sprites takes about as long as the rays. Standing still costs nothing.

Memory:

| Address | Contents |
|---------|----------|
| `$0340` | the pistol's two sprite images (the tape buffer) |
| `$0400` | screen A |
| `$0801–$2FFF` | code, tables and variables |
| `$3000` | 16 sprite blocks, 8 per screen |
| `$3400` | screen B |
| `$3800` | the APEXSCII raycast set |
| `$4000` | the map, object images, movement and status tables, read-only data, the song and the sprite code |
| `$C000` | multiply tables |

The map must stay below `$8000`: each ray keeps the address of the tile it hit with a flag in bit 7 of its high byte.

```bash
node c64/build.js
```

This needs [cc65](https://cc65.github.io/) on the PATH, and writes `c64/out/apex.prg`.

```bash
node showcase/c64-video.js "C:\path\to\GTK3VICE-3.10-win64"
```

This records the engine in VICE, playing a scripted walk with the same controls a joystick gives. It takes a screenshot of every second frame through the remote monitor and joins them into `showcase/out/c64-e1m1.mp4`.

## Testing

`test/vice-check.js` writes each still as a `.prg`, runs it in [VICE](https://vice-emu.sourceforge.io/), and compares all 64,000 display pixels with the reference renderer.

```bash
node test/vice-check.js "C:\path\to\GTK3VICE-3.10-win64"
```

`--ntsc` runs on an NTSC machine. `--cycles 12000000,15000017` screenshots at each listed cycle count. The script ends with PASS or FAIL.

All the C64 checks run through the kit's test runner (`test/kit.js`), so they share their switches: `--ntsc`, `--model`, `--quick` and `--timing` (see *The C64 kit*).

`test/c64-check.js` tests the 6502 engine itself. It builds the engine in test mode at 11 poses along the walk, so each build draws one frame and stops, and one more firing with a guard hit. Five more builds play the game from scripts: turning (which reuses rays), walking, sliding along and into walls and a guard, shooting a guard, and walking round to the treasure. Their final frame must match the same game played in JavaScript. Every frame the C64 draws must match the reference pixel for pixel, sprites included. Then the shooting and treasure scripts play again with the sound ticked with the game, on one SID and on two, and every tick's SID registers must match the reference's. Pass `--ntsc` to test on NTSC too.

```bash
node test/c64-check.js "C:\path\to\GTK3VICE-3.10-win64"
node test/c64-bench.js "C:\path\to\GTK3VICE-3.10-win64"
```

`test/c64-bench.js` (`--nosound` leaves the music out) builds a version that turns 4/1024 of a turn every frame for 64 frames: a quarter turn from the start, past the guards. Each frame turns the same amount however long it takes, so every build draws the same frames. `--walk` walks along the first corridor instead. It times them with the VICE monitor's stopwatch and prints cycles per frame and frames per second.

## Platformer

A side-scrolling platformer engine for the C64, with layers of parallax for depth, smooth scrolling at 50 frames a second and tight controls. A JavaScript reference defines every frame; the 6502 engine draws exactly the same frames, checked pixel for pixel in VICE.

To play on a C64 or in VICE, load `c64/out/side.prg` with `LOAD"*",8,1`, then `RUN`. Use a joystick in port 2 (fire or up to jump), or A and D to run and W, Z or Space to jump; R starts again. `showcase/out/side-c64.mp4` is a recording of it running in VICE (before the objects and sound were added).

**The game** (`core/platform.js` `game`, `play`): coins to collect, beetles that walk their ground (turning at a wall or a ledge's edge) and die when landed on, bouncing the player up, but send the player back to the start when touched any other way, and a flag that wins and starts the level again. `sound/hills.js` is its music, an original upbeat chiptune in C major, with effects for jumping, coins, stomps, hurts, falls and the win.

| File | What it is |
|------|------------|
| `core/platform.js` | Levels, player physics, the camera and the game (coins, beetles, the flag), in integer maths |
| `sound/hills.js` | Green Hills' music and effects |
| `c64/side/view.js` | What the C64 screen shows each frame |
| `levels/side/w1.txt` | Green Hills, the first level |
| `web/side.html` | The reference, playable in a browser (`web/bundle.js` makes one-file versions in `web/out/`) |
| `c64/side/side.s`, `game.s` | The 6502 engine (ca65), and its game |
| `c64/side/gen.js`, `build.js` | Turn the reference into the engine's tables, characters, sprites and drawing code, and assemble it |
| `test/side-check.js` | Plays the level in VICE and checks every pixel of the C64's frames against the reference, and that no frame is late |
| `showcase/side-pilot.js` | An autopilot that runs the level, used by the videos and the test |
| `showcase/side.js` | The reference's autopilot run, as `showcase/out/side-run.mp4` |
| `showcase/side-c64-video.js` | Records the C64 engine's autopilot run in VICE, as `showcase/out/side-c64.mp4` |

**Screen.** Multicolor characters, 38 columns, three bands, each with its own hardware fine scroll and colours set by raster splits:

| Rows | Layer | Speed |
|------|-------|-------|
| 0–4 | Mountains: lit rock, rock in shadow, snow | 1/4 |
| 5–8 | Hills | 1/2 |
| 9–24 | The level, in APEXSCII side-oblique blocks (forest theme): grass tops and earth sides receding up-right | 1 |
| 9–24 | A forest behind the level, in its empty cells | 3/4 |

The forest is four characters per row pattern, redrawn each frame with the pattern shifted; it moves in 2-pixel steps, as multicolor pixels are 2 wide. Colour RAM never changes, so it never has to scroll. The level band's background starts as the hills' green behind the treetops and turns to sky a few lines down, behind solid canopy. The whole look takes 85 of the 212 free characters.

The mountains and hills scroll by their share of the camera rounded up, so every band's first column changes on the same frame as the level's (at a camera of 8k + 1).

**Levels** are text, one character per 16×16 block: `#` solid, `.` empty, `P` the start, `o` a coin, `b` a beetle, `F` the flag. The engine draws each block as a 2×2-character front with its top and side one character up and right, choosing APEXSCII's glyphs for every cell from which faces cover its two halves.

**Physics** runs once per 50 Hz frame, in 1/16 pixel:
- running: speeds up and slows down rather than starting and stopping dead
- jumping: up to 3.5 blocks, lower when the button is let go early
- grace: a jump still works for 5 frames after running off a ledge, and a jump pressed up to 6 frames before landing happens on landing
- collision: the player box is 12×20 pixels, checked against blocks one axis at a time
- camera: it follows the player within a dead zone

**The C64 engine.** Each frame it reads the controls, moves the player one tick and moves the camera, all in the reference's integer steps, then works out the next frame for the bottom-of-frame IRQ to show:
- *two screens*: when a band's first column changes, the engine redraws that band from its source into the screen that isn't showing, then swaps. Each source row is a page, so a band redraws with one load and one store per character
- *raster splits*: the bottom IRQ shows the new screen and sets the mountains' scroll and colours, the sprite and the forest's characters. Three more IRQs set the hills' scroll, the level's scroll, and the sky behind the treetops. The bands' colours change in their ground lines, which show only colour RAM, so only the scroll has to land in the narrow border window. Writes from 46 to 60 cycles after the raster line starts pass every test on PAL and NTSC, and the engine uses 53
- *the forest*: 20 characters are rewritten from a table only when its shift changes (16 shifts)
- *predrawing*: in a frame that doesn't swap screens, one band of the hidden screen is drawn as the next swap will want it, where the camera, going on as it last moved, next changes a column (and during the win, the new game's first screen). A swap then usually finds its screen ready, which keeps the busiest frames well inside the time
- *objects*: up to 7 of the coins, beetles and flag are hardware sprites 1-7, the nearest the player first. The coins and the flag are in order across the level, so their distances fall towards the player and rise past it: two runs already in order, merged with the beetles. Each beetle walks a range worked out from the level once, instead of testing blocks
- *sound*: the kit's SID driver, ticked with the game and written to the SID at the start of the bottom IRQ
- *memory*: BASIC and the KERNAL are switched out, and the IRQs use the hardware vector

The level must be 8 blocks high and at most 127 wide, so a row of characters, plus the forest past its end, fits in a page. Green Hills is 127 wide.

| | PAL | NTSC |
|---|---|---|
| Frames late in the 26 s game run (coins, stomps, the win and the restart), one SID or two | 0 | 0 |
| Slowest frame, from the bottom of one frame to the next being ready | 52% of a frame | 78% |

NTSC runs 60 ticks a second, so the game plays 20% faster there.

```bash
node showcase/side.js
node web/bundle.js
node c64/side/build.js
node test/side-check.js "C:\path\to\GTK3VICE-3.10-win64"
node showcase/side-c64-video.js "C:\path\to\GTK3VICE-3.10-win64"
```

## Isometric dungeon

A Diablo-style dungeon for the C64: an isometric 2:1 view that scrolls smoothly in every direction with the hero always at the centre, and a torchlight radius around them. A JavaScript reference defines every frame; the 6502 engine draws exactly the same frames at 50 frames a second, checked pixel for pixel in VICE.

To play on a C64 or in VICE, load `c64/out/iso.prg` with `LOAD"*",8,1`, then `RUN`. Use a joystick in port 2, or W, A, S and D (two at once for diagonals); R starts again. `showcase/out/iso-c64.mp4` is a recording of it running in VICE.

| File | What it is |
|------|------------|
| `core/iso.js` | Maps, and the hero's movement and collision, in integer maths |
| `c64/iso/view.js` | What the C64 screen shows each frame |
| `levels/iso/d1.txt` | The Crypt: nine rooms and their corridors on a 48×48 map, with wall torches and cracked flagstones |
| `showcase/iso-pilot.js` | An autopilot that tours the rooms along shortest paths |
| `showcase/iso.js` | The autopilot's tour, as `showcase/out/iso-run.mp4` |
| `c64/iso/iso.s` | The 6502 engine (ca65) |
| `c64/iso/gen.js`, `build.js` | Turn the reference into the engine's code maps, characters, sprites, screen copies and light fixups, and assemble it |
| `test/iso-check.js` | Plays the tour and an eight-direction walk in VICE, checks every pixel of the C64's frames against the reference, and checks that no frame is late |
| `showcase/iso-c64-video.js` | Records the C64 engine's tour in VICE, as `showcase/out/iso-c64.mp4` |

**Screen.** Multicolor characters, 38 columns by 24 rows, with the VIC's fine scroll in both directions. Tiles are 32×16 pixel diamonds and walls are cubes 16 pixels high. On a 2:1 grid each screen character can show parts of at most four tiles, and which four depends only on its phase: its place on the grid, one of four. Each character is therefore a table lookup by its phase and those tiles' looks: void, floor, cracked floor, wall, or wall with a torch. The phase also fixes which part of each tile a character shows, so textures can follow the tiles: flagstones with joints along the diamonds, wall tops in half mortar, lit sides in two courses of brick, shaded sides in alternate lines, and a contact shadow at each wall's foot. Only the cases a map uses get a character: the Crypt needs 53, out of a limit of 128.

**Light.** The light never changes as the dungeon scrolls under it, and it comes in two parts:
- *colour RAM* gives bit pair 11 (the lit stone) its colour, in rings around the hero: yellow, then red, then black
- *half-lit characters*: every character also exists half-lit, with its lit stone thinned to a checkerboard, as codes 128–255. Bit 7 of each screen code picks the half-lit one, in rings fixed on the screen

Together they make five steps from full light to dark, blended across the rings with a 2×2 ordered dither. The other bit pairs are fixed colours. Black is void and floor joints. White is torch flames, so torches glow in the dark. Dark grey is mortar, so outside the light the walls still show faintly as grey outlines. On the C64 the half-lit bit costs an `and` and an `ora` per character when the screen shifts.

**Movement.** One tick per 50 Hz frame, in 1/256 tile:
- walking: the eight joystick directions at one speed, 2 pixels a frame across the screen and 1 up and down
- collision: the hero's square, half a tile across, stays on floor, checked one axis at a time so the hero slides along walls
- the hero is a multicolor sprite that never moves; the camera is always centred on them

**The C64 engine.** Each frame it reads the controls, moves the hero one tick and works out the camera, then leaves the next frame for the bottom-of-frame IRQ to show:
- *code maps*: for each phase and anchor tile, the character, 64×64 anchors by 4 phases in 16K. A character is one lookup, and along a row or column the anchor steps in a fixed pattern by phase, so a new edge row or column is unrolled code with no arithmetic per character
- *two screens*: when the view moves a whole character, the screen that isn't showing becomes the other one shifted (an unrolled copy, 9 cycles a character), then the new edge row or column is looked up. A diagonal step moves both ways at once
- *the light's half-lit bits*: a shift carries each character's bit 7 to a new place in the fixed rings, so the generator lists the characters where it is now wrong and emits code that flips them (about 180 to 200 a shift). Each list also serves the opposite direction, run with X as the offset
- *the IRQ*: one, below the display, sets the screen, both fine scrolls and the hero's sprite frame together
- *memory*: BASIC and the KERNAL are switched out; the light's fixups load under BASIC's ROM

The map must fit 64×64 tiles, and the screen's anchors from anywhere the hero can stand must span at most 64×64; the generator checks both. The Crypt's span 62×62.

| | PAL | NTSC |
|---|---|---|
| Frames late in the tour (1,800 ticks) and the eight-way walk (480) | 0 | 0 |
| Slowest frame's work (a diagonal step with both edges) | 80% of a frame | 93% |

```bash
node showcase/iso.js
node web/bundle.js
node c64/iso/build.js
node test/iso-check.js "C:\path\to\GTK3VICE-3.10-win64"
node showcase/iso-c64-video.js "C:\path\to\GTK3VICE-3.10-win64"
```

### The Drowned Crypt

A demo of what the dungeon engine can make: a small action game in the browser, with a C64 version still to come. An investigator in a long raincoat clears a drowned crypt with a pistol. Drowned fish-men shamble at him, tentacled spawn lurch at him in bursts, and in a chamber at the end the Mother of the Deep rips up out of the floor. It spits, sends tentacles up under his feet, and takes 24 shots to sink. Out of the torchlight a creature shows only its glowing eyes. Holding fire plants his feet so he can aim in all 8 directions.

The dungeon is cut from drawn tiles here, not the textures (`M.art`, see `c64/iso/view.js`): a floor, a cracked floor, a wall and a torch wall drawn as pixel grids and placed with each tile, so every character is cut from the drawings. It uses 59 characters. The boss is six sprites drawn from shaded, outlined shapes. The music stops while it is up (see Sound).

| File | What it is |
|------|------------|
| `core/crypt.js` | The game's reference: the creatures, the pistol, the boss, hearts and score |
| `levels/iso/c1.txt` | The map: four rooms, their corridors and the boss's chamber |
| `c64/crypt/` | Its view (`view.js`), drawn tiles (`tiles.js`) and sprites (`sprites.js`) |
| `sound/crypt.js` | Its music and effects |
| `web/crypt.html` | The game, playable in a browser, with its sound |
| `showcase/crypt-pilot.js`, `showcase/crypt.js` | An autopilot that clears the crypt, and its video with the C64's sound from VICE (`showcase/out/crypt-run.mp4`) |

## Shoot-'em-up

A vertical-scrolling shooter for the C64, over the hull of a space dreadnought, and the first APEX game that is a whole game: a title, three ships, a score and a high score, game over, music and sound effects. Everything that moves is a hardware sprite: the ship, its shots, the enemies, their bullets, the explosions and the titles. The score sits in a status bar that stays still while the level scrolls above it. That is more than the VIC's eight, so a sprite multiplexer shares them out down the screen. A JavaScript reference defines every frame and every SID register; the 6502 engine draws exactly the same frames and plays exactly the same sound at 50 frames a second, checked in VICE.

To play on a C64 or in VICE, load `c64/out/shmup.prg` with `LOAD"*",8,1`, then `RUN`, and press fire. Use a joystick in port 2, or W, A, S and D to fly and Space to fire (hold it for autofire); R goes back to the title. `showcase/out/shmup-c64.mp4` is a recording of it running in VICE, with its sound.

To play the reference, open `web/shmup.html` from a local server, or `web/out/shmup-play.html` directly. Use the arrow keys or W, A, S and D to fly, and Space, Ctrl or K to fire. R goes back to the title. The reference has no sound.

| File | What it is |
|------|------------|
| `core/shmup.js` | The level, the ship, its shots, the enemies and their bullets, in integer maths with fixed slots |
| `c64/shmup/view.js` | What the C64 screen shows each frame, including the multiplexer's rule |
| `levels/shmup/s1.txt` | The Dreadnought: 120 rows of 20 tiles, two hull sections with domes, superstructure, pipes and a hazard-striped trench, turrets, and waves of drones and swoopers |
| `web/shmup.html` | The reference, playable in a browser |
| `showcase/shmup-pilot.js` | An autopilot that lines up under enemies and sidesteps what's coming |
| `showcase/shmup.js` | The autopilot's run, as `showcase/out/shmup-run.mp4` |
| `sound/shmup.js` | The music and sound effects (see *Sound*) |
| `c64/shmup/shmup.s` | The 6502 engine (ca65) |
| `c64/shmup/gen.js`, `build.js` | Turn the reference into the engine's characters, sprites, level rows, tables and screen shifts, and assemble it |
| `test/shmup-check.js` | Plays the autopilot's run and a sweep through a whole game (shot down three times, game over, the title, a new game) in VICE. Checks every pixel of the C64's frames and every tick's SID registers against the reference, and that no frame and no sprite is late |
| `showcase/shmup-c64-video.js` | Records the C64 engine in VICE (the title, then the autopilot), with its sound, as `showcase/out/shmup-c64.mp4` |

**Screen.** Multicolor characters, 40 columns by 24 rows. The VIC's vertical fine scroll moves the screen down one line a frame. Tiles are 16×16 pixels (2×2 characters), each drawn from its own kind and its neighbours:
- *armour*: panels of 2×2 tiles with seams and corner rivets, and lit and shaded rims along the hull's edges. One panel in seven is recessed: dark, with a shadow along its top and left
- *fittings*: vents, lamps, pipes running along and across, and hazard stripes on the hull's nose and the trench walls
- *raised structures*: domes, lit from the top left and casting a shadow, and blocks of superstructure with a row of lit windows along their fronts
- *turret bases*, and the hull's front face hanging below its edge over space

The Dreadnought needs 140 characters. Colour RAM is one value for the whole screen, so scrolling never touches it.

**Parallax stars.** Two layers of stars drift down behind the hull, slower than it: white near stars at half its speed and grey far stars at a quarter. Empty space shows them through 32 star characters that are redrawn every frame. They come from 4 textures, each a column 64 lines tall holding one star of each layer, cut into 8 characters. Every 8 character rows, a hash picks which texture each column of space shows (or none) and which row of it to start from, so the stars don't line up. Each frame, a texture's lines move up by half a line for the near layer and three quarters for the far one. Against the screen's one line down, that leaves the stars moving down at ½ and ¼ speed. On the C64 that costs 256 bytes rewritten per frame.

**Sprites and the multiplexer.** The objects to show are sorted by Y, and the n-th one shown gets hardware sprite n mod 8. An object is shown only if it starts at least 24 lines below the last object on its hardware sprite. That leaves time for the VIC to finish the previous object and for an interrupt to set up the next. Otherwise the object is left out for that frame. Where sprites overlap, the lower hardware sprite is in front, as on the VIC. The autopilot's run peaks at 14 sprites on screen at once, and none is dropped.

**The game.** One tick per 50 Hz frame:
- *the ship*: 2 pixels a frame in eight directions, with a twin shot every 8 frames while fire is held
- *drones*: arrive in columns of four and snake down the screen
- *swoopers*: dive, fire one aimed bullet, then turn back up and away
- *turrets*: ride the hull and fire every 64 frames (staggered, so turrets that arrive together don't fire together), taking three hits to destroy

Bullets aim at one of 16 directions, chosen by integer comparisons. A hit costs a ship. You come back after a moment and are untouchable for 120 frames, blinking. The level wraps round.

**The whole game.** The title shows DREADNOUGHT and a blinking PRESS FIRE while the level scrolls by, with the high score in the status bar. Fire (pressed, not just held) starts a game with three ships, wherever the level has got to, so the screen never has to be redrawn. Losing the last ship shows GAME OVER for 5 seconds, then the title again, with the high score if it was beaten. In play, the status bar along the bottom shows the score (six digits) at the left and a ship for each ship left at the right. The titles are sprites and the bar is characters, both in the same chunky 3×5 font with a drop shadow. Each tick also lists what happened (a shot, an enemy firing, a turret hit, an explosion, the ship lost), and those start the sound effects; the music plays throughout.

**The C64 engine.** Each frame it reads the controls, plays one tick of the game as `core/shmup.js` does (fixed slots, the same order, 16-bit positions), and works out the next frame, which the bottom-of-frame IRQ then shows:
- *two screens*: every 8 frames the view moves a whole row, so the screen that isn't showing becomes the shown one moved down a row, with the level's next row at its top. It's copied in 25 small parts (the new top row, then each row) over the other 7 frames: each frame does at least its share, and more ahead while the raster says it has time to spare, so a busy frame seldom pays for much. The screens swap at the bottom of the frame together with the fine scroll
- *two character sets*: the stars are redrawn in the one that isn't showing, so they never tear. Only their old and new bytes are touched, about 16 a frame
- *the multiplexer*: the objects are sorted by (Y, slot), starting from last frame's order, so there is little to sort. Then they get hardware sprites by the reference's rule. Sprites 0–7 are set at the bottom of the frame. Each later one is set by a raster IRQ on the line after its hardware sprite's last object has drawn its last row (rows 18–20 are empty in every frame), and the IRQ chains straight on to one due a line later. The IRQ counts any sprite set up after its first line has begun, and there are none
- *the status bar*: the last 8 lines of the screen are a character row that doesn't scroll. The multiplexer has a split hook. On the line before the bar it sets the fine scroll to 7 and points the VIC at a third screen. A fine scroll of 7 makes the bar's first line a bad line, so the VIC fetches a character row there whatever the playfield's scroll. The row it fetches is always row 23. At fine scroll 0–6 the playfield's row 23 is under way, and a bad line in the middle of a row fetches that same row again, because the VIC only moves on to the next row after a row's 8th line. At fine scroll 7, row 23 starts there anyway. So the bar's screen holds the bar in row 23, rewritten only when it changes. Sprites below the split take their pointers from that screen, so the 8 pointers are copied across. Sprites due within 2 lines of the split wait until after it, which is still in time. The bottom IRQ puts the playfield's scroll, screen and pointers back
- *the titles*: sprites like any other object, taken by the multiplexer after the bullets: up to 30 objects
- *the screen copy*: fully unrolled, 8 cycles a character, as 11K of code loaded under BASIC's ROM
- *sound*: the kit's SID driver plays the music and starts the game's effects where the reference lists its events; the bottom-of-frame IRQ writes the SID at the same moment every frame
- *memory*: VIC bank 1 holds both screens, both character sets, the sprites and the status bar's screen; BASIC and the KERNAL are switched out

| | PAL | NTSC |
|---|---|---|
| Sprites set up late, and frames lost any other way | 0 | 0 |
| Frames late in the autopilot's run (2,400 ticks) | 0 | 21 (0.9%) |
| Frames late in the sweep through a whole game (2,400 ticks) | 0 | 3 (0.1%) |
| Slowest frame's own work (before copying ahead) | 76% of a frame | 90% |

On PAL, the machine it's made for, the whole game is never late. NTSC frames are 13% shorter, and in the busiest stretches a frame there is shown twice now and then (a little more since the SID driver plays effects on every voice); the NTSC timing test reports that as a failure.

The timing test also times each whole script with VICE's stopwatch, so a frame lost any other way, such as an IRQ chain that misses the bottom of a frame, would show up too.

**With an REU.** At start-up the shooter looks for an REU (`reu_detect`). With one, it copies the other screen by DMA instead of with the CPU. At the start of each frame's work, just after the bottom IRQ, it copies the top row and then 4 rows by DMA, about 400 cycles. That is in the border, where no IRQ is due for many lines, which matters because the DMA stops the CPU and its IRQs. The first 6 frames after a swap finish the copy, well ahead of when it's due, and the CPU's copy does whatever is left. 4 rows a frame did best: 3, 6, 12 and 24 were tried. The frames are the same with or without an REU, and the tests check them both ways (`--reu`). On NTSC it removes most of the late frames:

| NTSC, late frames in 2,400 ticks | Without an REU | With an REU |
|---|---|---|
| The autopilot's run | 21 | 8 |
| The run, with two SIDs | 34 | 13 |
| The sweep through a whole game | 4 | 1 |
| The sweep, with two SIDs | 9 | 1 |

The frames still late are ones where the game's own work runs past an NTSC frame without any copying. On PAL there are none either way.

**The brick look.** Build with `--brick` (`node c64/shmup/build.js --brick` writes `c64/out/shmup-brick.prg`) and the Dreadnought is built from toy bricks: APEXSCII's Brick theme (its `brick-stud` texture) gives a stud a character on the armour and the raised blocks, lit white on the upper left and shaded on the lower right, and the recessed panels become flat tiles. Only the character set changes, so the engine and its timing are the same; `test/shmup-check.js` and `showcase/shmup-c64-video.js` take `--brick` too (the video goes to `showcase/out/shmup-c64-brick.mp4`).

```bash
node showcase/shmup.js
node web/bundle.js
node c64/shmup/build.js
node test/shmup-check.js "C:\path\to\GTK3VICE-3.10-win64"
node showcase/shmup-c64-video.js "C:\path\to\GTK3VICE-3.10-win64"
```

## Story mode

Scenes told over a picture larger than the screen, which pans slowly under them like an old documentary, with the words typed beneath and choices that change what happens next. A JavaScript reference defines every frame; the 6502 engine shows exactly the same frames, checked pixel for pixel in VICE. Games can use it for their story between levels.

To play on a C64 or in VICE, load `c64/out/story.prg` with `LOAD"*",8,1`, then `RUN`. `web/story.html` plays the reference in a browser.

| File | What it is |
|------|------------|
| `core/story.js` | The story format and how it plays, tick by tick |
| `c64/story/view.js` | What the C64 screen shows each frame |
| `stories/mountain.js` | The Mountain, the demo: a traveller meets the guide at the foot of APEX |
| `stories/mountain-pictures.js` | Its picture, converted (`node c64/story/pictures.js mountain`, with ffmpeg) |
| `sound/peak.js` | Its music, and the text's effects |
| `web/story.html` | The reference, playable in a browser |
| `c64/story/story.s` | The 6502 engine (ca65) |
| `c64/story/gen.js`, `build.js` | Turn the story, its pictures, the font and the song into the engine's data, and assemble it |
| `test/story-check.js` | Plays the story in VICE and checks every pixel of the C64's frames against the reference (every frame of the zooms and turns too), every SID tick, that no frame is late, and that the frames load from the disk |

**A story** is a module of pictures and scenes. Each picture is converted from any image to a multicolor bitmap of any size in cells (`art/picture.js` `cells`). Each scene names a picture, a pan across it (from, to, and how many ticks), a speaker and the text, and then either up to 4 choices (each going to a scene, and able to set a flag, or to show only if a flag is set or isn't), the next scene, or the end. The text wraps into 38-letter lines, 4 to a page, in APEXSCII's text font (capitals). A scene that moves to another picture, or to another part of this one, goes dark for 16 ticks while the window is readied.

**The screen.**
- *the window*: lines 55-167, a multicolor bitmap panned to the pixel both ways by the VIC's fine scroll, 38 columns wide
- *the gap*: 11 black lines in an invalid mode. FLD (a fine scroll that no line matches) holds off the bad lines, so the window's last character row always runs its 8 lines: the VIC moves on to the next screen row only then, and the text then always starts on the same row
- *the text*: rows 15-23 of its own screen and colour RAM, from line 179: the speaker in yellow, 4 lines in white, and the choices in grey, the chosen one a reversed bar. Each row's colour is fixed, so colour RAM there never changes

**The C64 engine.**
- *two windows*: the window is double-buffered across VIC banks 0 and 2. While one shows, the main loop runs the pan on to find the next cell it needs, and copies it into the other a row at a time. The frame that needs it flips the bank; colour RAM, which can't be doubled, is copied for it in the border after the window
- *the text*: has its own screen and font in bank 1, switched to in the gap. A row the main loop changes is copied to the text screen at the top of the next frame, so the text and the window always change together
- *pans*: at most a pixel a tick, and the window's cell may change at most every 8 ticks (copying a window takes about 6 frames); `core/story.js` checks both
- *memory*: the picture's rows go wherever the VIC doesn't look (`c64/story/gen.js` `REGIONS`); the variables sit under the KERNAL, switched out

**Zooms, pull-backs and turns.** A C64 can't scale or rotate a bitmap in real time, so these are runs of frames made ahead of time. A picture can be `frames: { count, from, to }`, each of from and to a point in the image to keep at the window's middle, the image's width to show and an angle (degrees, clockwise). The converter crops, turns and scales each frame from the image, the width stepping evenly in scale so a zoom moves at a steady rate. A scene with `steps: { frames, every, reverse }` shows them one after another, a frame every `every` ticks (3 at least); played in reverse, a zoom is a pull-back from the same frames. The Mountain zooms up to its summit, pulls back, and turns the world at the end.

Frames are window-sized, 6000 bytes each, too many for the C64's memory, so they live in an REU. A frame comes into the hidden window by DMA, a few lines at a time away from the split, in about a frame. At start-up the engine looks in the REU for the frames (a signature after them); if they aren't there it loads them from files on its disk (`mountain.f00`, ...). That takes a while on a stock drive (each 6000-byte file is several seconds at the KERNAL's speed), so `c64/out/story/mountain.reu` holds them as an REU image: VICE takes it with `-reuimage`, and a C64 Ultimate can preload it into its REU at start-up (its REU settings), so the frames are there at once. Without an REU the window stays dark while frames play.

```bash
node c64/story/pictures.js mountain
node c64/story/build.js
node test/story-check.js "C:\path\to\GTK3VICE-3.10-win64"
```

## The C64 kit

What every C64 engine shares lives in `c64/kit/` and `test/`, so a new engine starts from a template instead of a copy of the last one.

| File | What it is |
|------|------------|
| `c64/kit/build.js` | Assembles an engine with ca65 and ld65 (with the kit on the include path), and makes its test builds: a script of inputs played in place of the controls, and extra constants such as `PROFILE` |
| `c64/kit/kit.inc` | The BASIC line, the machine's set-up (RAM in place of BASIC and the KERNAL, the IRQ vector, a cleared zero page), the script player, frame timing, late-frame counting, and the profiler's `MARK`s |
| `c64/kit/mux.inc` | The sprite multiplexer, as the shoot-'em-up uses it: `SHOW` each object, `mux_build` sorts them and gives them hardware sprites, and two IRQs set them up down the screen. An engine can add a raster split of its own, which the chain fits between sprites |
| `c64/kit/sid.inc`, `sidgen.js` | The SID driver, and the tables it plays from (see *Sound*) |
| `c64/kit/reu.inc` | The REU: `reu_detect` (its address registers keep what's written to them; without one, $DF00-$DFFF reads whatever is on the bus) and `reu_copy`, which copies within the C64 by DMA, out to the REU and back, at 2 cycles a byte against the CPU's 8. The CPU and its IRQs wait while it runs, so an engine calls it where no IRQ is due for that long |
| `test/kit.js` | The VICE checks: frames compared pixel for pixel, timing runs (late frames, late sprites, the slowest frame), the sound's registers, and a verdict |
| `test/profile.js` | Plays an engine's script in a profiling build and shows how its slowest frame's cycles split between its parts |

Every engine's test takes the same switches:
- `--ntsc`, or `--model <name>` for any machine VICE has: `c64`, `c64c`, `c64old`, `ntsc`, `newntsc`, `oldntsc`, `drean`
- `--quick` for a few frames, and `--timing` for the timing runs alone

The tests have run on all of VICE's C64 models: the C64 (6569 VIC-II), the C64C (8565), the early C64 (6569R1), NTSC (6567R8) and the newer NTSC (8562), the old NTSC (6567R56A, 64 cycles a line and 262 lines), and the Argentinian Drean (PAL-N, 65 cycles a line). On every one, the raycaster, the platformer and the dungeon draw every frame exactly and are never late, the raster splits included, and the SID driver sets every register exactly. The shoot-'em-up draws every frame exactly on all of them; its timing is in its own section.

A failing frame's screenshot is kept in the temp folder's `apex-check-failures`. Now and then VICE's autostart leaves the C64 at BASIC's READY prompt instead of running the program. Such a frame runs once more, and the test says so.

The raycaster builds with the kit and plays its scripts, but keeps the KERNAL and its own IRQ set-up: its gradient's writes are tuned to the KERNAL's IRQ entry, to a cycle.

```bash
node test/profile.js "C:\path\to\GTK3VICE-3.10-win64" shmup sweep
```

## Sound

Music and sound effects for the SID, made the way the pictures are: `core/sound.js` is the reference, and the 6502 driver `c64/kit/sid.inc` sets exactly the same 25 SID registers on every tick. The test compares registers, not audio. The driver keeps them in RAM, and copies them to the SID once a frame. The test checks a running checksum of every tick's registers, and the last tick's, against the reference.

- *music*: three voices, each playing 32-row patterns from its own order list. A row is a note, a release, or nothing. Instruments set the waveform, ADSR, a sweeping pulse width, an arpeggio and a gate length. A new note restarts hard: one tick with the gate off and the ADSR at 0, so the SID's envelope counter comes round at once and the note's attack starts on time. Without the ADSR at 0 the chip's "ADSR bug" can hold an attack back by up to 33 ms, which on a short note loses it altogether
- *drums*: an instrument can instead have a table, a waveform and a note for each tick (the note played plus some semitones, or a fixed note), so a kick is a fast pitch drop and a clap a burst of noise
- *the filter*: a resonant low-pass (or band or high) whose cutoff sweeps up and down from a table, over the voices whose instruments use it
- *effects*: steps of a waveform, a sliding frequency, ADSR and a length, each played on its own voice (the song's effects voice unless it names another) instead of the music, which goes on underneath. Effects on different voices play at once. A new effect starts unless one of higher priority is playing on its voice
- *the music off*: the game can turn the music off. The song stands still, every voice fades on its release, and the effects have the voices to themselves. Turned on, the song goes on from where it stopped
- *two SIDs*: with a second SID at $D420, as a C64 Ultimate can have, the music plays on the first and the effects on the second, each on its own voice there, so they never interrupt the music and can overlap. When an effect ends, its voice keeps its last registers with the gate off, so its release plays out. The driver checks for a second SID at start-up (`snd_detect`). Without one, those addresses are just the first SID again, since the chip's registers repeat every $20 bytes. So it holds voice 3 of the second still, runs the first's as a fast sawtooth, and reads the second's voice 3 output: always 0 from a real second SID. The same program plays one SID or two. The browser pages play two
- `sound/shmup.js`: the Dreadnought's music, an original late-80s house track at 125 beats a minute in A minor. A four-on-the-floor kick with offbeat hats and claps, an octave-jumping bass through the sweeping filter, and arpeggiated chord stabs that give way to a hook. The effects borrow the stabs' voice, so firing never stops the beat. It loops every 31 seconds
- `sound/crypt.js`: the Drowned Crypt's music, an original creeping cue in the manner of a 1920s silent film, in D minor at 75 beats a minute. A plucked bass walking chromatically into each change, stride chords on 2 and 4, and a melody that tiptoes up onto ghostly held notes. The hero's and creatures' effects are short and sit under the music. When the boss rises the music stops for its roar, moans, screeches and death shriek. `EVENTS` maps the game's events to effects
- `sound/hills.js`: Green Hills' music, an original upbeat chiptune in C major at 150 beats a minute, and `sound/cell.js`: the Cell Block's, a brooding A minor piece (see their engines)

### The SID in the browser

`core/sid.js` emulates the SID, so the browser pages play the same sound. It doesn't need to be cycle-exact, because the C64 tests compare registers. It plays the register image `core/sound.js` makes each frame:

- *voices*: three oscillators with 24-bit accumulators, giving triangle, sawtooth, pulse, noise from the 23-bit shift register, and combinations as their bitwise AND. Sync, ring modulation and the test bit work too
- *envelopes*: as on the chip, a 15-bit rate counter that is never reset, so the ADSR bug happens, and a second counter that slows decay and release as the level falls
- *the filter*: a resonant state-variable filter following the 6581's cutoff curve, then the volume

`web/audio.js` runs it in an AudioWorklet, or a ScriptProcessor where worklets can't run (a page opened from a file). The page tells it each tick what the game did, and it starts on the first key press, click or touch, as browsers require. M mutes. The raycaster, platformer, shooter and Drowned Crypt pages use it.

`test/sid-compare.js` sets the emulation against VICE's recording of the same music and effects, in 100 ms slices. For the Drowned Crypt, its loudness over time correlates 0.92 with VICE's and its spectra match 0.93, at the same level. For the Dreadnought it's 0.88 and 0.80; the 6581's filter is hard to model.

| File | What it is |
|------|------------|
| `core/sound.js` | The reference player |
| `core/sid.js` | The SID emulation, for the browser and WAVs |
| `web/audio.js` | Plays a game's sound in a browser page |
| `c64/sound/` | A player program for a song (`node c64/sound/build.js crypt`): the music, with the joystick (or a test's script) playing the effects |
| `test/sound-check.js` | For each song, on one SID and on two, plays it for two loops, each effect alone, effects piling up, and the music off and on, in VICE, and compares every tick's registers. Then checks the driver finds a second SID when VICE has one at $D420, and none when it doesn't |
| `test/sid-compare.js` | Compares the emulation's sound with VICE's recording |
| `showcase/sound-wav.js` | Records the player in VICE as `showcase/out/<song>-music.mp3` (and a WAV, not kept in git); with `--sids 2`, with a second SID, as `<song>-music-2sid.mp3` |

```bash
node c64/sound/build.js
node test/sound-check.js "C:\path\to\GTK3VICE-3.10-win64"
node showcase/sound-wav.js "C:\path\to\GTK3VICE-3.10-win64" --song crypt --seconds 58
node test/sid-compare.js crypt 58
```

## Playing on a C64 or C64 Ultimate

`c64/out/apex-8.d81` holds everything that runs on a C64, behind a menu. It's a 1581 disk image, since the programs don't fit a 1541's. On a C64 Ultimate, copy it to a USB stick, open the stick in the Ultimate's menu, select the image and choose to mount and run it. On a C64 with a 1581 or an SD2IEC, use `LOAD"*",8` then `RUN`. Press a number to load a program. It runs at once; reset to get back to the menu.

| Key | Program | Controls |
|-----|---------|----------|
| 1 | The raycaster, the Cell Block | Joystick in port 2 (fire to shoot), or W/S to walk, A/D to turn and Space to fire |
| 2 | The platformer, Green Hills | Joystick in port 2 (fire or up to jump), or A/D to run and W, Z or Space to jump; R restarts |
| 3 | The dungeon, the Crypt | Joystick in port 2, or W/A/S/D (two at once for diagonals); R restarts |
| 4 | The shooter, the Dreadnought | Joystick in port 2, or W/A/S/D and Space to fire (hold for autofire); fire starts, R restarts |
| 5 | The shooter in the brick look | As 4 |
| 6, 7, 8, 9 | The Dreadnought's, the Drowned Crypt's, Green Hills' and the Cell Block's songs on the sound player | Joystick directions and fire play the first five effects |
| 0 | The APEX-8 splash | |
| S | The story mode, the Mountain (its zooms and turns need an REU: it loads them from the disk, or preload `mountain.reu`) | Fire (or space or return) to go on; joystick up and down, or W and S, to pick a choice |

Each program is also in `c64/out` as a `.prg`, which the Ultimate can run straight from its file browser.

**Settings.** The engines are made and tested for a stock PAL C64: 50 frames a second, the CPU at 1 MHz, a 6581 SID. On a C64 Ultimate:

- *video*: PAL. The engines also pass on NTSC, but run at 60 frames a second with 13% less time for each. The shooter is late now and then in its busiest stretch on NTSC.
- *CPU*: no turbo. The engines time their raster splits and sprite multiplexing to the stock speed. A faster CPU hasn't been tested, and VICE can't emulate the Ultimate's turbo modes.
- *SID*: a 6581, or UltiSID set to 6581. The music's filter settings were made for it; an 8580 sounds brighter. With a second SID at $D420, the shooter, the platformer, the raycaster and the sound players find it and play their effects on it, so the music never stops for them. On PAL that costs the shooter nothing that shows. On NTSC it is late a little more often: 32 frames in its run and 9 in its sweep, against 21 and 3 on one SID.
- *REU*: on. The shooter finds it and copies its screen by DMA (see the shooter's *Timing*); without one it copies with the CPU, as on a stock C64.

`node c64/disk.js <VICE folder>` makes the disk again from the programs in `c64/out` (build them first). It uses VICE's `petcat` and `c1541`.

## The demo site

`docs/` is the demo site GitHub Pages serves at [jedi12many.github.io/apex-8](https://jedi12many.github.io/apex-8/): a menu (`web/index.html`) with a still of each demo, every playable page as a single file, and the C64 programs with `apex-8.d81`. `node web/site.js` builds it again: it bundles the pages (`web/bundle.js`), renders the raycaster's and the platformer's stills from their references, takes the others from the showcase videos, and copies `c64/out`. Build the programs and the disk first. The raycaster's page shows its status panel in APEXSCII's own text font, where the C64 uses its ROM font.

```bash
node web/site.js
```

## The APEX-8 badge

Games made with APEX-8 can carry its badge: a striped sun setting behind a snowy mountain over APEX-8. `art/brand/apex8.js` draws it for the C64's multicolor modes: 40×48 fat pixels with at most 3 colours a cell, so it drops into a bitmap or a character set as it is. The Drowned Crypt shows it on its title. `art/brand/apex8-source.png` is the full-size art.

`art/picture.js` turns any picture into a C64 multicolor bitmap. For each 4×8 cell it picks the 3 colours that match best and ordered-dithers between them, and writes a Koala Painter file and a preview. `c64/picture/` shows a Koala picture on a C64; by default the APEX-8 splash (`art/brand/apex8-splash.kla`), made from the badge's art, which a game can show before its own title. `test/picture-check.js` checks it in VICE pixel for pixel.

```bash
node art/picture.js art/brand/apex8-source.png art/brand/apex8-splash.kla --crop 27,150,1200,840 --saturation 1.2 --dither 24
node c64/picture/build.js
node test/picture-check.js "C:\path\to\GTK3VICE-3.10-win64"
```

## Roadmap

The raycaster is a renderer so far. These are what a game built on it would need, in a sensible order. None is planned yet.

1. **Doors:** door tiles drawn as a thin wall in the middle of the tile, sliding open, with a state per door (opening, open, closing) and collision while shut. Rays that reach a door tile take one more step. Locked doors need keys.
2. **Game state:** health, ammo, score, keys and lives; pickups that disappear; an exit tile and level end. Objects become live entries rather than fixed tables.
3. **Actions:** a fire button whose hit is the nearest object in the centre column in front of the wall there (one ray and a depth check), with damage and a cooldown.
4. **Actors:** state machines (stand, notice, chase, attack, hurt, die), line of sight with one ray, moving along tile centres with the player's collision rules, updated every few ticks.
5. **Sprite memory:** animation frames are the real limit. Each object type is stored at up to 36 sizes, about 2KB a type, so a guard with 6 frames would need about 13KB. The options are fewer sizes, small sizes only for some frames, scaling at run time, or the RAM under the BASIC and KERNAL ROMs.
6. **HUD and held item:** status in the panel; a held item at the bottom of the view, as sprites or characters.
7. **Sound:** SID effects from the top-of-frame IRQ, perhaps music; about 1–3% of the CPU for effects.
8. **Levels:** loading from disk with light compression, a title screen, restart and level end.
9. **Sprite multiplexer:** more than 8 sprites, by reusing them further down the screen, fitted around the gradient's raster IRQs.
10. **Speed:** objects. Projecting each one takes a 32÷16 divide, and cutting their sprites costs as much as the rays when they are close; more actors make this the first thing to speed up.
11. **Game logic in `core/`:** the rules as integer JavaScript with a tick function, like the raycaster, so every port must reach the same game state from the same input; the scripted C64 tests already check movement this way.
12. **Other machines:** 16-, 32- and 64-bit ports share `core/` and `levels/` and add bitmap rendering with textured walls.

## Licence

The code is MIT, copyright (c) 2026 jedi12many; see [LICENSE](LICENSE). The APEX-8 name and badge have their own rules: see [BRAND.md](BRAND.md).
