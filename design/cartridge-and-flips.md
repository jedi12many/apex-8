# Cartridges, and flipping between engines

A plan, not built yet. To revisit after testing on real hardware.

## Where games run

Players are assumed to have a Kung Fu Flash or an SD2IEC, or a C64 Ultimate. No floppies.

| Device | Runs | Notes |
|---|---|---|
| Kung Fu Flash | EasyFlash cartridge images (CRT), PRGs | no REU |
| C64 Ultimate | EasyFlash CRTs, PRGs, disk images | has an REU |
| SD2IEC | PRGs and disk images, through the KERNAL | a drive: no cartridge images; plain loading runs at about 1541 speed |

## The main format: an EasyFlash cartridge

An EasyFlash cartridge holds up to 1MB, banked into the C64's memory in 8K or 16K windows, and reads as fast as RAM. One CRT can hold a whole game: every engine, the levels, the stories, the pictures, and story mode's zoom and turn frames.

- **No loading.** An engine or an asset is copied in from the cartridge when it's needed.
- **Zooms and turns without an REU.** A 6000-byte frame copies from the cartridge in about 2 to 3 C64 frames: slower than REU DMA, but enough for story mode's steps. Stills remain the fallback where frames can't be had.
- **One file for Kung Fu Flash and the C64 Ultimate.** On the Ultimate the REU becomes optional.
- **Testable.** VICE runs EasyFlash images, so the pixel-for-pixel checks carry over.

## Flipping between engines

For example: the hero meets someone in the isometric dungeon, the game flips to story mode for the conversation, and then flips back to the same place in the dungeon.

The engines each use the whole of memory (the same VIC banks, the RAM under the ROMs, the IRQ vectors), so they can't both be in the 64K at once. Instead of freezing all of memory, a flip saves the game's state and rebuilds from it. The dungeon engine already draws its whole screen from the game's state.

1. **Save.** The dungeon writes its state to a small block both engines leave alone: the hero, the creatures, the items, the flags and the random seed. That's a few hundred bytes.
2. **Talk.** Story mode is copied in from the cartridge and starts at the conversation's scene. When it ends, it writes the outcome (flags, items, rewards, a door unlocked) to the same block.
3. **Return.** The dungeon engine is copied back in, restores its state, reads the outcome and redraws. A quick fade out and in hides the switch.

With an REU (the C64 Ultimate), a flip could instead freeze all 64K into the REU and fetch it back, about 4 frames each way. The save-and-rebuild flip works everywhere, so it comes first.

## SD2IEC

SD2IEC can't run cartridge images, so it gets the game as files: PRGs, or a disk image on the SD card. Plain KERNAL loading from it takes minutes at our sizes. SD2IEC speeds up several known fast loaders on its own; choosing one from its current compatibility list would bring a flip down to seconds. Without frames in memory, story mode shows its stills there.

## What apex-8 needs (for any game)

- **A cartridge builder:** packs the engines and assets into an EasyFlash CRT, with a start-up menu in place of the disk's.
- **Kit routines:** bank in the cartridge, and copy an engine or an asset into RAM.
- **The flip:** a kit routine for "save, switch to engine X at entry Y, come back", and the shared state block's layout.
- **Story mode:** start at a given scene, an "end and return" kind of scene, frames read from the cartridge, and its outcome written to the shared block.
- **The isometric engine:** NPCs that start a conversation when reached, and restoring the game from the shared block.
- **The browser versions:** the same flip between the references, which is just handing state over.
- **SD2IEC, later:** the game as files, plus a fast loader SD2IEC supports.

## Before building

- Check, on the hardware: Kung Fu Flash's and the C64 Ultimate's EasyFlash support, and how either behaves with the IRQ timing our engines rely on.
- Pick the SD2IEC fast loader from its current compatibility list.
- Measure how long a flip takes with each kind of copy, and whether a fade hides it.
