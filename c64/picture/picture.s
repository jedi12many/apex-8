; APEX picture viewer for the Commodore 64: shows a multicolor bitmap (a Koala Painter picture, by
; default the APEX-8 splash, art/brand/apex8-splash.kla) until the program is stopped. A game can show
; the engine's splash this way before its own title.
; Assemble with c64/picture/build.js, which names the picture (PICTURE in gen.inc).

.include "gen.inc"
.include "kit.inc"

SCREEN = $4400
PIC = $6000                 ; the bitmap; then the picture's screen data, colour data and background
PIC_SCREEN = PIC + 8000
PIC_COLOR = PIC + 9000
PIC_BG = PIC + 10000

.segment "ZEROPAGE"
inp:     .res 1
from:    .res 2
to:      .res 2

.segment "CODE"
start:
    KIT_INIT kit_nmi
    lda #<PIC_SCREEN        ; the screen's colours, then colour RAM
    ldx #>PIC_SCREEN
    ldy #>SCREEN
    jsr copy1000
    lda #<PIC_COLOR
    ldx #>PIC_COLOR
    ldy #$d8
    jsr copy1000
    lda PIC_BG
    sta $d021
    lda #0
    sta $d020
    lda $dd00               ; VIC bank 1 ($4000-$7FFF)
    and #$fc
    ora #2
    sta $dd00
    lda #$18                ; the screen at $4400, the bitmap at $6000
    sta $d018
    lda #$18                ; multicolor, 40 columns
    sta $d016
    lda #$3b                ; bitmap mode, the screen on
    sta $d011
park:
    jmp park

; 1000 bytes from A/X (low/high) to Y/$00.
copy1000:
    sta from
    stx from+1
    lda #0
    sta to
    sty to+1
    ldx #4                  ; 4 pages, the last only to 1000
    ldy #0
:   lda (from),y
    sta (to),y
    iny
    bne :-
    inc from+1
    inc to+1
    dex
    bne :-
    rts

.segment "PICTURE"
    .incbin PICTURE, 2
