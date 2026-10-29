; APEX sound player for the Commodore 64: plays a song and its effects with the kit's SID driver
; (c64/kit/sid.inc), a tick a frame. In SCRIPT builds, bit k of each tick's input starts effect k;
; otherwise the joystick in port 2 does (up, down, left, right, fire: effects 0-4).
; Assemble with c64/sound/build.js. The test (test/sound-check.js) compares the SID registers it
; writes with the reference (core/sound.js).

.include "gen.inc"
.include "kit.inc"
.include "sid.inc"

.segment "ZEROPAGE"
inp:     .res 1
bits:    .res 1

.segment "CODE"
start:
    KIT_INIT kit_nmi
    lda #0                  ; a title on a black screen
    sta $d020
    sta $d021
    ldx #TITLE_LEN - 1
:   lda TITLE,x
    cmp #$40
    bcc :+
    sbc #$40
:   sta $0400 + 12 * 40 + (40 - TITLE_LEN) / 2,x
    lda #1
    sta $d800 + 12 * 40 + (40 - TITLE_LEN) / 2,x
    dex
    bpl :--
    lda #$1b
    sta $d011
    lda #$15                ; the ROM font
    sta $d018
    jsr snd_init
    KIT_SCRIPT_START

main:
:   lda $d011               ; once a frame, at line 250
    bmi :-
    lda $d012
    cmp #250
    bne :-
    jsr snd_out
    jsr input
    bcc :+
    jmp kit_park
:   lda inp                 ; effects 0, 1, ... for bits 0, 1, ...
    sta bits
    ldx #0
@fx:
    lsr bits
    bcc :+
    txa
    jsr snd_fx
:   inx
    cpx #SND_EFFECTS
    bne @fx
    jsr snd_tick
    jmp main

; inp from the script, or the joystick in port 2; C set when a SCRIPT build's script has ended.
input:
.ifdef SCRIPT
    jmp kit_script
.else
    lda #$ff
    sta $dc00
    lda $dc00
    eor #$ff
    and #31
    sta inp
    clc
    rts
.endif

.segment "RODATA"
TITLE:   .byte "APEX SOUND"
TITLE_LEN = * - TITLE
