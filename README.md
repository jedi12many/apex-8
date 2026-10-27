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

## Layout

| Path | What it is |
|------|------------|
| `core/raycast.js` | The reference raycaster. Integer maths only, so ports can match it value for value. |
| `core/level.js` | The level format |
| `levels/` | Levels, as text grids |
| `c64/view.js` | The C64 view: 80 rays drawn with APEXSCII glyphs, plus a ROM-font status panel |
| `showcase/walk.js` | A walk through E1M1 as videos, runnable stills and a contact sheet |
| `test/vice-check.js` | Runs the stills in VICE and checks every pixel |
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

`makeCaster({ rays, fov, scale, maxH })` builds the tables for one view. `cast(map, x, y, angle)` returns one result per ray:
- `halfH`: the half wall height
- `side`: 0 when the ray hits an east/west face, 1 for north/south
- `tile`: the wall type
- `dist`: the corrected distance

`move()` moves the player, sliding along walls.

## Levels

Levels are text files with one character per tile:

| Character | Tile |
|-----------|------|
| `#` | wall |
| `1`–`9` | a wall of that type |
| `.` or a space | floor |
| `N`, `E`, `S`, `W` | the player's start, facing that way |

Lines starting with `;` are comments, and the first comment names the level. See `levels/e1m1.txt`.

## C64 view

- **Layout:**
  - the view is 320×160 on rows 0–19, with 80 rays, two per character column
  - rows 20–24 are a status panel in the ROM font, shown through APEXSCII's raster split
- **Drawing:**
  - each ray's half height becomes a 9-state value per cell (empty, or wall shade A or B at 2/4/6/8 pixels)
  - the two rays in a column pick the screen code `$40 + 9 × left + right` above the horizon, and `$91 + …` below it
  - the bottom half mirrors the top half, so one height gives both
  - east/west faces are shade B, as in Wolfenstein
- **Multicolor colours:**
  - ceiling: `$D021`
  - floor: `$D022`
  - wall A: `$D023`
  - wall B: colour RAM
  
  The colour RAM is one constant value, so a frame only rewrites the 800 screen codes. Walls are foreground pixels, so hardware sprites with background priority hide behind them.

```bash
node showcase/walk.js --rom "C:\path\to\GTK3VICE-3.10-win64\C64\chargen-901225-01.bin"
```

This writes the following to `showcase/out/`:
- `walk-mc.mp4` and `walk-hires.mp4`: 38 seconds at 25 fps
- ten runnable `.prg` stills
- `walk.png`

It needs ffmpeg. `--rom` shows the status panel in the real C64 ROM font.

## Testing

`test/vice-check.js` writes each still as a `.prg`, runs it in [VICE](https://vice-emu.sourceforge.io/), and compares all 64,000 display pixels with the reference renderer.

```bash
node test/vice-check.js "C:\path\to\GTK3VICE-3.10-win64"
```

`--ntsc` runs on an NTSC machine. `--cycles 12000000,15000017` screenshots at each listed cycle count. The script ends with PASS or FAIL.

## Roadmap

1. **C64 engine in 6502:** the same raycaster, using the same tables, assembled with cc65's ca65. The VICE test then checks the frames it draws itself against the reference.
2. **Game:**
   - movement and collision on the C64
   - doors
   - enemies as hardware sprites, which hide behind walls through sprite priority
3. **Other machines:** 16-, 32- and 64-bit ports share `core/` and `levels/` and add bitmap rendering with textured walls.

## Licence

MIT, copyright (c) 2026 jedi12many; see [LICENSE](LICENSE).
