; APEX sound player for the Commodore 64: plays a song and its effects with the kit's SID driver
; (c64/kit/sid.inc), a tick a frame. In SCRIPT builds each tick's input is an effect to start (its
; number + 1 in bits 0-4; 0 none) and bit 7 turns the music off; otherwise the joystick in port 2
; starts effects (up, down, left, right, fire: effects 0-4).
; Assemble with c64/sound/build.js. The test (test/sound-check.js) compares the SID registers it
; writes with the reference (core/sound.js).

.include "gen.inc"
.include "kit.inc"
.include "sid.inc"

.segment "ZEROPAGE"
inp:     .res 1

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
:   lda inp                 ; bit 7: the music off
    and #$80
    eor #$80
    sta snd_music
    lda inp                 ; the effect to start, + 1
    and #$1f
    beq :+
    sec
    sbc #1
    jsr snd_fx
:   jsr snd_tick
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
    ldy #0                  ; the first direction or fire held: effect 0-4, as 1-5
:   lsr
    bcs :+
    iny
    cpy #5
    bne :-
    ldy #$ff
:   iny
    sty inp
    clc
    rts
.endif

.segment "RODATA"
TITLE:   .byte "APEX SOUND"
TITLE_LEN = * - TITLE
