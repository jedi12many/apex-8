# APEX

A first-person raycasting game engine for 8-, 16-, 32- and 64-bit machines, starting with the Commodore 64.

Every platform shares:
- the level format
- the levels
- one reference raycaster

Each port draws in its own way, and is tested pixel for pixel against the reference. The C64 version draws with the [APEXSCII](https://github.com/jedi12many/apexscii) raycast character set, which is included as a submodule.

```bash
git clone --recurse-submodules https://github.com/jedi12many/apex.git
```

To play on a C64 or in VICE, load `c64/out/apex.prg` with `LOAD"*",8,1`, then `RUN`. Use a joystick in port 2, or W and S to walk and A and D to turn. `showcase/out/c64-e1m1.mp4` is a recording of it running in VICE.

## Layout

| Path | What it is |
|------|------------|
| `core/raycast.js` | The reference raycaster. Integer maths only, so ports can match it value for value. |
| `core/level.js` | The level format |
| `levels/` | Levels, as text grids |
| `c64/view.js` | The C64 view: 80 rays drawn with APEXSCII glyphs, plus a ROM-font status panel |
| `c64/sprites.js` | Guards, barrels and treasure as hardware sprites, scaled and hidden behind walls |
| `c64/apex.s`, `c64/sprites.s` | The C64 engine in 6502 assembly |
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
1. **Controls:** they run once for every 50 Hz tick since the last frame, so walking and turning speed don't depend on the frame rate. The player keeps 3/8 of a tile from walls and half a tile from an object's centre, on each axis, sliding along both; the test scripts check this against the same moves in JavaScript. If the player hasn't moved or turned, the screen showing is already right, and the frame stops here.
2. **Rays:** the even rays and the last are cast, then each odd ray is interpolated or cast, as in the reference. When the player has only turned, ray c is the ray c + turn / 2 was, so what its walk found (distance, face, `u`) shifts across, and only its corrected distance and height are worked out again. Only the rays coming in at the edge are cast. A fog ray keeps a lower bound on its distance, and is cast again if a column with a nearer fog line needs it. The DDA keeps the map column in the Y register, so a step east or west is one `INY` or `DEY`. Multiplications use quarter-square tables, built at start-up at `$C000`. The distance from the player to the next grid line is the same for every ray in a quadrant, so its multiplies, the steps and the 1/cos tables are patched in once per quadrant, not per ray. Wall heights come from a table lookup instead of a division.
3. **Objects:** each is projected, using signed multiplies, a 32÷16 divide and the angle table, and sorted nearest first.
4. **Wait:** the engine waits until the last frame is showing.
5. **Draw:** the view is drawn into the hidden screen, 400 cells of two lookups each. The objects' masked tiles go into that screen's sprite blocks, along with the status numbers.
6. **Swap:** the screens swap. The IRQ at the top of the frame shows the new screen and loads its sprite registers from a shadow copy, so walls and sprites always change together. A last IRQ switches to the ROM font for the status panel.

**Gradient.** The ceiling and floor darken towards the horizon, with dithered stripes between shades. Raster IRQs, generated from the reference's `GRADIENT`, change `$D021` and `$D022` in the right border of the line before each change. Top glyphs never use the floor colour and bottom glyphs never the ceiling colour, so each register only has to be on time in its own half. Three things keep the writes in the border:
- **No bad lines:** no change falls on a bad line or the line after one.
- **A line between changes:** every wait starts before its line does.
- **38-column mode:** the border hides the leftmost 7 and rightmost 9 pixels. Polling jitter and the VIC's sprite fetches can land a write a cycle early or late, and those pixels are where it would show.

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

Bricks only on walls within about 3 tiles (`TEX_NEAR` 20) ran at 8.2 fps turning before ray reuse, and scale 160 (in proportion at 56°) at 9.4 turning and 7.4 walking. Neither was worth it.

With guards close by, projecting and cutting their sprites takes about as long as the rays. Standing still costs nothing.

Memory:

| Address | Contents |
|---------|----------|
| `$0400` | screen A |
| `$0801–$2FFF` | code and tables |
| `$3000` | 16 sprite blocks, 8 per screen |
| `$3400` | screen B |
| `$3800` | the APEXSCII raycast set |
| `$4000` | object images, movement and status tables |
| `$C000` | multiply tables |

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

`test/c64-check.js` tests the 6502 engine itself. It builds the engine in test mode at 11 poses along the walk, so each build draws one frame and stops. Three more builds play scripted controls: turning (which reuses rays), walking, and sliding along and into walls and a guard. Their final position must match the same moves made in JavaScript. Every frame the C64 draws must match the reference pixel for pixel, sprites included. Pass `--ntsc` to test on NTSC too.

```bash
node test/c64-check.js "C:\path\to\GTK3VICE-3.10-win64"
node test/c64-bench.js "C:\path\to\GTK3VICE-3.10-win64"
```

`test/c64-bench.js` builds a version that turns 4/1024 of a turn every frame for 64 frames: a quarter turn from the start, past the guards. Each frame turns the same amount however long it takes, so every build draws the same frames. `--walk` walks along the first corridor instead. It times them with the VICE monitor's stopwatch and prints cycles per frame and frames per second.

## Platformer

A side-scrolling platformer engine for the C64, with layers of parallax for depth, smooth scrolling at 50 frames a second and tight controls. A JavaScript reference defines every frame; the 6502 engine draws exactly the same frames, checked pixel for pixel in VICE.

To play on a C64 or in VICE, load `c64/out/side.prg` with `LOAD"*",8,1`, then `RUN`. Use a joystick in port 2 (fire or up to jump), or A and D to run and W, Z or Space to jump; R starts again. `showcase/out/side-c64.mp4` is a recording of it running in VICE.

| File | What it is |
|------|------------|
| `core/platform.js` | Levels, player physics and the camera, in integer maths |
| `c64/side/view.js` | What the C64 screen shows each frame |
| `levels/side/w1.txt` | Green Hills, the first level |
| `web/side.html` | The reference, playable in a browser (`web/bundle.js` makes one-file versions in `web/out/`) |
| `c64/side/side.s` | The 6502 engine (ca65) |
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

**Levels** are text, one character per 16×16 block: `#` solid, `.` empty, `P` the start. The engine draws each block as a 2×2-character front with its top and side one character up and right, choosing APEXSCII's glyphs for every cell from which faces cover its two halves.

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
- *memory*: BASIC and the KERNAL are switched out, and the IRQs use the hardware vector

The level must be 8 blocks high and at most 127 wide, so a row of characters, plus the forest past its end, fits in a page. Green Hills is 127 wide.

| | PAL | NTSC |
|---|---|---|
| Frames late in the 26 s autopilot run | 0 | 0 |
| Slowest frame, from the bottom of one frame to the next being ready | 64% of a frame | 76% |

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
| `web/iso.html` | The reference, playable in a browser (`web/bundle.js` makes one-file versions in `web/out/`) |
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

MIT, copyright (c) 2026 jedi12many; see [LICENSE](LICENSE).
