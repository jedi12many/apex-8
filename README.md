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

Rays are spaced evenly across the screen, not in angle, so walls stay straight.

With `interpolate`, only the even rays and the last are cast. An odd ray whose two neighbours hit the same face of the same tile takes the mean of their heights and distances. On a flat wall, 1/distance changes linearly across the screen, so the mean is within 2 pixels of a cast. Any other odd ray is cast. Along the E1M1 walk this casts 47.5 of the 80 rays a frame, and about 3 rays a frame differ from a full cast, by 2 pixels.

With `fog`, a wall whose half height would be `fog` pixels or less is too far away to see. Its ray returns no wall (`halfH` 0, `dist` 0xFFFF), and `project()` leaves out objects at that depth or more. `FOG_PERP` is the nearest distance where that happens, so a port can stop each ray's walk there.

`makeCaster({ rays, fov, scale, maxH, interpolate, fog })` builds the tables for one view. `cast(map, x, y, angle)` returns one result per ray:
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
  - the view is 320×160 on rows 0–19, with 80 rays, two per character column
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
1. **Controls:** they run once for every 50 Hz tick since the last frame, so walking and turning speed don't depend on the frame rate. If the player hasn't moved or turned, the screen showing is already right, and the frame stops here.
2. **Rays:** the even rays and the last are cast, then each odd ray is interpolated or cast, as in the reference. The DDA keeps the map column in the Y register, so a step east or west is one `INY` or `DEY`. Multiplications use quarter-square tables, built at start-up at `$C000`. The distance from the player to the next grid line is the same for every ray in a quadrant, so its multiplies, the steps and the 1/cos tables are patched in once per quadrant, not per ray. Wall heights come from a table lookup instead of a division.
3. **Objects:** each is projected, using signed multiplies and a 32÷16 divide, and sorted nearest first.
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

**Speed.** On the benchmark's quarter turn past the guards, a frame takes 126,495 cycles, 7.8 frames a second on PAL:

| Build | Cycles a frame | Frames a second |
|-------|----------------|-----------------|
| Before interpolation and per-quadrant set-up | 144,208 | 6.8 |
| With them | 112,194 | 8.8 |
| Plus the gradient | 124,553 | 7.9 |
| Plus fog | 106,285 | 9.3 |
| Plus bricks | 126,495 | 7.8 |
| Bricks only within about 3 tiles (`TEX_NEAR` 20) | 119,608 | 8.2 |

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

`test/c64-check.js` tests the 6502 engine itself. It builds the engine in test mode at 11 poses along the walk, so each build draws one frame and stops. Two more builds play scripted controls: turning, walking, and sliding along and into walls. Their final position must match the same moves made in JavaScript. Every frame the C64 draws must match the reference pixel for pixel, sprites included. Pass `--ntsc` to test on NTSC too.

```bash
node test/c64-check.js "C:\path\to\GTK3VICE-3.10-win64"
node test/c64-bench.js "C:\path\to\GTK3VICE-3.10-win64"
```

`test/c64-bench.js` builds a version that turns 4/1024 of a turn every frame for 64 frames: a quarter turn from the start, past the guards. Each frame turns the same amount however long it takes, so every build draws the same frames. It times them with the VICE monitor's stopwatch and prints cycles per frame and frames per second.

## Roadmap

1. **Game:**
   - doors
   - enemy behaviour and animation frames
   - a sprite multiplexer for more than 8 sprites
2. **Speed:** objects. Projecting each one takes a 32÷16 divide, and cutting their sprites is now as costly as the rays when guards are close.
3. **Other machines:** 16-, 32- and 64-bit ports share `core/` and `levels/` and add bitmap rendering with textured walls.

## Licence

MIT, copyright (c) 2026 jedi12many; see [LICENSE](LICENSE).
