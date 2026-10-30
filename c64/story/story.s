; APEX story mode for the Commodore 64: scenes told over a picture, with text and choices, exactly as
; core/story.js plays them and c64/story/view.js shows them.
;
; The screen: a multicolor bitmap window (lines 55-167, 24-row mode, 38 columns) panned to the pixel by
; the fine scroll, 11 black lines (an invalid mode, with FLD holding off the bad lines so the window's
; last row always ends: the VIC moves to the next screen row only when a row has had its 8 lines), then
; the text area (text mode, 38 columns, from line 179: screen and colour rows 15-23). The window is double-buffered across VIC banks 0 and 2: while one shows, the main loop copies
; the next cell of the pan into the other, a row at a time, and the frame that needs it flips the bank;
; colour RAM, which can't be doubled, is copied for it in the border after the window. The text has its
; own screen and font in bank 1, switched to at the split, and a row the main loop changes is copied to
; it at the top of the next frame, so text and window always change together.
;
; Each frame: the top IRQ shows what the main loop worked out for the last tick (window bank, scrolls,
; text rows), writes the sound and starts the next tick; the main loop plays the tick (core/story.js),
; ticks the sound, and works out the next frame; then, until the next tick, copies the window.
;
; Zooms, pull-backs and turns are runs of frames (window-sized pictures) in the REU, which the engine
; loads at start-up from files on its disk and copies into the hidden buffer by DMA, a few lines at a
; time away from the split. Without an REU, a scene's steps show its still: a picture held at a pan
; (or a dark window, if it has none).
;
; Memory: $0400 bitmap screen A, $2000 bitmap A (bank 0); $4000 text screen, $4800 the font (bank 1);
; $4C00 code and data; $8400 bitmap screen B, $A000 bitmap B (bank 2); picture rows wherever is left
; (c64/story/gen.js REGIONS). BASIC and the KERNAL are switched out; the IRQs use the hardware vector.

.include "gen.inc"           ; (first: a test build's SCRIPT and SND_STEREO are in it)
.include "kit.inc"
.include "sid.inc"

.segment "EXEHDR"           ; (the kit's SYS 2061 lands here: the code is at $4C00)
    jmp start

BMP_A    = $2000
SCR_A    = $0400
BMP_B    = $a000
SCR_B    = $8400
TXT      = $4000
TROW     = TXT + 15 * 40     ; the text area's first row on the text screen
IRQ_TOP  = 10                ; the top IRQ's line, above the display on PAL and NTSC
IRQ_SPLIT = 165              ; the split's IRQ: it polls for line 167, then the gap's lines
D011_WIN = $30               ; bitmap, display on, 24 rows (+ the fine scroll)
D011_DARK = $70              ; an invalid mode (black) with the same rows: the window while dark
D011_GAP = $70               ; the same, plus a fine scroll that is no line's bad line for a while
D011_TEXT = $1b              ; text, 25 rows, scroll 3
D018_WIN = $18               ; bitmap at +$2000, its screen at +$0400 (banks 0 and 2 alike)
D018_TEXT = $02              ; text screen at +$0000, font at +$0800 (bank 1)
FRAMES_OK = $47ff            ; start-up's note that the frames are in the REU (bank 1, unused)
LOADBUF  = $a000             ; where a frame file loads at start-up (bitmap B, not yet in use)
SIGBUF   = $0340             ; the REU's signature, fetched at start-up (the tape buffer)
REU_CMD  = $df01
REU_C64  = $df02
REU_ADDR = $df04
REU_LEN  = $df07
REU_CTRL = $df0a

.segment "ZEROPAGE"
inp:     .res 1             ; this tick's input: 1 up, 2 down, 16 fire
held:    .res 1
press:   .res 1
t0:      .res 1
t1:      .res 1
t2:      .res 1
t3:      .res 1
ptr:     .res 2
src:     .res 2
dst:     .res 2
sa:      .res 1
sx:      .res 1
sy:      .res 1
rp:      .res 2             ; a TEXTBUF row (the main loop)

.segment "BSS"
; the story's state (core/story.js start)
scene:   .res 1
page:    .res 1             ; within the scene
pgx:     .res 1             ; the page's index in PG_LEN
shown:   .res 1
wait:    .res 1
phase:   .res 1             ; 0 typing, 1 a page waits for fire, 2 the choices, 3 the scene is done
sel:     .res 1
xf:      .res 1             ; the pan, 8.8 pixels: fraction, then the pixel (16 bits)
xp:      .res 2
yf:      .res 1
yp:      .res 2
pt:      .res 2             ; the pan's tick
flags:   .res 2
blank:   .res 1
clock:   .res 1
nch:     .res 1             ; the choices shown, as indexes into CH_*
chl:     .res 4
; the window: the cell each buffer holds (picture $FF: none) and the one being readied
fpic:    .res 1             ; the front buffer (showing, or about to): picture, column, row
fcx:     .res 1
fcy:     .res 1
hpic:    .res 1             ; the hidden buffer
hcx:     .res 1
hcy:     .res 1
tpic:    .res 1             ; the target: what the hidden buffer is being readied for ($FE: find it)
tcx:     .res 1
tcy:     .res 1
haveframes: .res 1          ; 1: the frames are in the REU
sframe:  .res 1             ; a scene's steps: the frame it is at, and the ticks into it
stick:  .res 1
crow:    .res 1             ; the target's next row to copy, and how many steps it takes (15, a frame 17)
climit:  .res 1
cphase:  .res 1             ; and the step of it: 0-4 the bitmap, 5 the screen and colours
front:   .res 1             ; the front buffer: 0 bank 0, 1 bank 2
flipwait: .res 1            ; 1: a flip is asked for and the top IRQ hasn't made it yet
; the lookahead: the pan run on from the present until its cell changes
lscene:  .res 1
lxf:     .res 1
lxp:     .res 2
lyf:     .res 1
lyp:     .res 2
lt:      .res 2
; the next frame, for the top IRQ (p_*), and what it shows now
ready:   .res 1
tick:    .res 1             ; the top IRQ's signal to the main loop
p_d011:  .res 1
p_d016:  .res 1
p_flip:  .res 1
colpend: .res 1             ; colour RAM to copy at the split, for a flip at the next top
d011:    .res 1
d016:    .res 1
dirty:   .res 2             ; text rows the top IRQ is to copy (bit r: row 16 + r)
tdirty:  .res 2             ; rows this tick changed
; what the text rows show, to know what changed
s_scene: .res 1
s_page:  .res 1
s_shown: .res 1
s_ch:    .res 1             ; the choice rows' signature: shown, selection, flags, prompt
s_sel:   .res 1
s_fl:    .res 2
s_pr:    .res 1
cnew:    .res 1             ; the cell work_cell found
cnx:     .res 1
cny:     .res 1
TEXTBUF: .res 360           ; the text area as it is to show (9 rows of 40)
COLBUF:  .res 600           ; colour RAM for the hidden buffer's window (15 rows of 40)

.segment "CODE"
start:
    jsr load_frames         ; (with the KERNAL, before it is switched out)
    KIT_INIT irq_top
    lda #0                  ; the variables (under the KERNAL) all 0
    tax
:
.repeat 6, P
    sta $e000 + P * $100,x
.endrepeat
    inx
    bne :-
    lda FRAMES_OK
    sta haveframes
    lda #0
    sta $d020
    sta $d021
    sta $d015
    ; the text screen all spaces, the text area's colours fixed per row
    ldx #0
    lda #$20
:   sta TXT,x
    sta TXT + $100,x
    sta TXT + $200,x
    sta TXT + $300,x
    inx
    bne :-
    ldx #39
:   lda #ROW_COLOR0
    sta $d800 + 15 * 40,x
    lda #ROW_COLOR1
    sta $d800 + 16 * 40,x
    sta $d800 + 17 * 40,x
    sta $d800 + 18 * 40,x
    sta $d800 + 19 * 40,x
    lda #ROW_COLOR5
    sta $d800 + 20 * 40,x
    sta $d800 + 21 * 40,x
    sta $d800 + 22 * 40,x
    sta $d800 + 23 * 40,x
    dex
    bpl :-
    lda #$ff
    sta fpic
    sta hpic
    sta s_scene             ; (no text drawn yet)
    sta s_page
    sta s_ch
    lda #0
    sta front
    sta flipwait
    sta colpend
    sta p_flip
    sta flags
    sta flags+1
    sta clock
    sta held
    sta tick
    jsr snd_init
    KIT_SCRIPT_START
    ldx #START
    lda #1                  ; (the first scene starts dark)
    jsr enter
    jsr frame               ; the first frame's registers and text
    lda #$ff
    sta dirty
    lda #1
    sta dirty+1
    lda #1
    sta ready

    lda #IRQ_TOP            ; the raster IRQ, then on
    sta $d012
    lda #$1b
    sta $d011
    lda #1
    sta $d01a
    sta $d019
    cli
    lda #1                  ; late frames count from here
    sta counting

main:
    lda tick
    beq @work
    lda #0
    sta tick
    jsr play
    jmp main
@work:
    jsr work
    jmp main

; ------------------------------------------------------------------ the IRQs
; Top of the frame: show what the main loop worked out, sound, and the next tick.
irq_top:
    sta sa
    stx sx
    sty sy
    KIT_TIMER_START
    lda ready
    bne @apply
    KIT_LATE
    jmp @show
@apply:
    lda #0
    sta ready
    lda p_d011
    sta d011
    lda p_d016
    sta d016
    lda p_flip
    beq :+
    lda #0
    sta p_flip
    sta flipwait
    lda front
    eor #1
    sta front
:   jsr copy_rows           ; the text rows that changed
@show:
    lda $dd00               ; the window's bank: 0 (%11) or 2 (%01)
    and #$fc
    ldx front
    ora BANKS,x
    sta $dd00
    lda #D018_WIN
    sta $d018
    lda d011
    sta $d011
    lda d016
    sta $d016
    jsr snd_out             ; the sound, at the same moment every frame
    lda #1
    sta tick
    lda #IRQ_SPLIT
    sta $d012
    lda #<irq_split
    sta $fffe
    lda #>irq_split
    sta $ffff
    lda #1
    sta $d019
    lda sa
    ldx sx
    ldy sy
    rti

; Below the window: scroll 4 early in line 167 (no bad line on 168), then black from line 168, written
; in the border after 167's pixels; then, each few lines,
; a fine scroll that no line until the next write matches (FLD), so there is no bad line and the window's
; last row runs its 8 lines; the text's bank, screen and scroll; and text mode from line 176, when the
; VIC is idle whatever the window's scroll (it shows $7FFF, 0: black).
irq_split:
    sta sa
    stx sx
    sty sy
    lda #167
:   cmp $d012
    bne :-
    lda d011                ; at fine scroll 7, line 167 is the window's last bad line, which holds
    and #7                  ; the CPU until about cycle 55
    cmp #7
    beq @seven
    ora #D011_WIN           ; otherwise scroll 4 now (the bitmap still showing): line 168 isn't a bad
    and #$f8                ; line whatever the window's scroll was
    ora #4
    sta $d011
    ldx #SPLIT_DELAY
:   dex
    bpl :-
    jmp @black
@seven:
    ldx #SPLIT_DELAY7       ; (long enough that the bad line holds the CPU here)
:   dex
    bpl :-
@black:
    lda #D011_GAP | 4       ; black from line 168, in the border between: scroll 4, no bad line on 168-171
    sta $d011
    lda $dd00               ; bank 1 for the text
    and #$fc
    ora #%10
    sta $dd00
    lda #D018_TEXT
    sta $d018
    lda #0
    sta $d016
    lda #170
:   cmp $d012
    bne :-
    lda #D011_GAP | 7       ; scroll 7: none on 170-174
    sta $d011
    lda #174
:   cmp $d012
    bne :-
    lda #D011_GAP | 3       ; scroll 3: none on 174-178; 179 is the text's first bad line
    sta $d011
    lda #176
:   cmp $d012
    bne :-
    lda #D011_TEXT          ; scroll 3: none until 179
    sta $d011
    lda colpend             ; a flip at the next top: its colours, now the window is done
    beq :+
    jsr copy_colours
    lda #0
    sta colpend
:   lda #IRQ_TOP
    sta $d012
    lda #<irq_top
    sta $fffe
    lda #>irq_top
    sta $ffff
    lda #1
    sta $d019
    lda sa
    ldx sx
    ldy sy
    rti

; The window's colour RAM (rows 0-14) from COLBUF.
copy_colours:
.repeat 600, K
    lda COLBUF + K
    sta $d800 + K
.endrepeat
    rts

; The text rows marked in dirty, from TEXTBUF to the text screen.
copy_rows:
.repeat 9, R
    lsr dirty+1
    ror dirty
    bcc :++
    ldx #39
:   lda TEXTBUF + R * 40,x
    sta TROW + R * 40,x
    dex
    bpl :-
:
.endrepeat
    rts

; ------------------------------------------------------------------ a tick
play:
.ifdef SCRIPT
    jsr kit_script
    bcc :+
    jmp kit_park
:
.else
    jsr input
.endif
    lda held
    eor #$ff
    and inp
    sta press
    lda inp
    sta held
    inc clock
    lda blank
    beq :+
    dec blank
    jmp @after
:   jsr pan_step
    jsr text_step
@after:
    jsr frame
    jsr snd_tick
    KIT_TIMER_MAX
    rts

; inp from the joystick in port 2 and the keyboard (space or return for fire, W/S up/down).
input:
    lda $dc00
    eor #$ff
    and #$13
    sta inp
    lda #$fd                ; row 1: W ($02), S ($20)
    sta $dc00
    lda $dc01
    eor #$ff
    tax
    and #$02
    beq :+
    lda inp
    ora #1
    sta inp
:   txa
    and #$20
    beq :+
    lda inp
    ora #2
    sta inp
:   lda #$7f                ; row 7: space ($10)
    sta $dc00
    lda $dc01
    and #$10
    bne :+
    lda inp
    ora #16
    sta inp
:   lda #$fe                ; row 0: return ($02)
    sta $dc00
    lda $dc01
    and #$02
    bne :+
    lda inp
    ora #16
    sta inp
:   lda #$ff
    sta $dc00
    rts

; The pan's step, until its ticks are done.
pan_step:
    ldx scene
    lda pt
    cmp SC_TLO,x
    lda pt+1
    sbc SC_THI,x
    bcs @done
    inc pt
    bne :+
    inc pt+1
:   lda SC_STEPN,x          ; steps: the next frame every SC_EVERY ticks
    beq :+
    inc stick
    lda stick
    cmp SC_EVERY,x
    bne :+
    lda #0
    sta stick
    inc sframe
:   clc
    lda xf
    adc SC_DXLO,x
    sta xf
    lda SC_DXHI,x
    jsr sext
    adc xp
    sta xp
    tya
    adc xp+1
    sta xp+1
    clc
    lda yf
    adc SC_DYLO,x
    sta yf
    lda SC_DYHI,x
    jsr sext
    adc yp
    sta yp
    tya
    adc yp+1
    sta yp+1
@done:
    rts

; A (a signed byte) and Y its sign extension ($00 or $FF); keeps the carry.
sext:
    ldy #0
    ora #0                  ; (sets N, keeps C)
    bpl :+
    dey
:   rts

; The text: typing, waiting for a page, the choices, the end (core/story.js play step 3).
text_step:
    lda phase
    beq @type
    cmp #1
    beq @more
    cmp #2
    bne :+
    jmp @choose
:   lda press               ; done: fire goes on
    and #16
    beq @rts
    lda #SND_MORE
    jsr fx
    ldx scene
    lda SC_NEXT,x
    cmp #$ff
    bne :+
    lda #START
:   tax
    lda #0
    jmp enter
@rts:
    rts
@more:
    lda press
    and #16
    beq @rts
    inc page
    inc pgx
    lda #0
    sta shown
    sta wait
    sta phase
    lda #SND_MORE
    jmp fx
@type:
    ldx pgx
    lda press               ; fire, once some is shown: the rest
    and #16
    beq @letter
    lda shown
    beq @letter
    lda PG_LEN,x
    sta shown
    lda #0
    sta wait
    beq @full
@letter:
    lda shown
    cmp PG_LEN,x
    bcs @full
    inc wait
    lda wait
    cmp #TYPE_SPEED
    bne @full
    lda #0
    sta wait
    inc shown
    lda #SND_TYPE
    jsr fx
    ldx pgx
@full:
    lda shown
    cmp PG_LEN,x
    bne @rts
    ldx scene               ; the page is full: more pages, the choices, or done
    lda page
    clc
    adc #1
    cmp SC_NPAGES,x
    bcs :+
    lda #1
    sta phase
    rts
:   lda SC_NCH,x
    beq :+
    lda #2
    sta phase
    jmp list_choices
:   lda #3
    sta phase
    rts
@choose:                    ; (as the reference: up only if it can, else down only if it can, else fire)
    lda press
    and #1
    beq :+
    lda sel
    beq :+
    dec sel
    lda #SND_MOVE
    jmp fx
:   lda press
    and #2
    beq :+
    ldx sel
    inx
    cpx nch
    bcs :+
    stx sel
    lda #SND_MOVE
    jmp fx
:   lda press
    and #16
    beq @rts2
    lda nch
    beq @rts2
    ldx sel
    ldy chl,x               ; the choice taken
    lda CH_SET,y
    jsr set_flag
    lda #SND_CHOOSE
    jsr fx
    ldx sel
    ldy chl,x
    ldx CH_GO,y
    lda #0
    jmp enter
@rts2:
    rts

; Effect A (SFX_*), unless $FF.
fx:
    cmp #$ff
    beq :+
    jmp snd_fx
:   rts

; flags |= 1 << A, unless A is $FF.
set_flag:
    cmp #$ff
    beq @no
    tax
    lda BITLO,x
    ora flags
    sta flags
    lda BITHI,x
    ora flags+1
    sta flags+1
@no:
    rts

; Z clear if flag A ($FF: none, which counts as clear) is set.
test_flag:
    cmp #$ff
    beq @no
    tax
    lda BITLO,x
    and flags
    bne @yes
    lda BITHI,x
    and flags+1
    rts
@no:
    lda #0
@yes:
    rts

; The choices the scene shows with these flags, into chl (nch of them).
list_choices:
    ldx scene
    lda SC_CH0,x
    sta t0
    clc
    adc SC_NCH,x
    sta t1
    lda #0
    sta nch
@one:
    ldy t0
    cpy t1
    bcs @done
    lda CH_IF,y             ; shown if its if flag is set (or it has none) and its unless flag isn't
    cmp #$ff
    beq :+
    jsr test_flag
    beq @next
:   ldy t0
    lda CH_UNLESS,y
    jsr test_flag
    bne @next
    ldx nch
    lda t0
    sta chl,x
    inc nch
@next:
    inc t0
    jmp @one
@done:
    rts

; Into scene X (A 1: the first, always dark): the start of its text and pan, its flag, and dark if
; the window has to change picture or cell (core/story.js enter).
enter:
    sta t2
    stx scene
    lda xp                  ; the old cell, for the comparison
    clc
    adc #7
    sta t0
    lda xp+1
    adc #0
    lsr
    ror t0
    lsr
    ror t0
    lsr
    ror t0
    lda yp+1
    sta t1
    lda yp
    lsr t1
    ror
    lsr t1
    ror
    lsr t1
    ror
    sta t1
    lda #0
    sta page
    sta shown
    sta wait
    sta phase
    sta sel
    sta pt
    sta pt+1
    sta xf
    sta yf
    sta sframe
    sta stick
    lda SC_X0LO,x
    sta xp
    lda SC_X0HI,x
    sta xp+1
    lda SC_Y0LO,x
    sta yp
    lda SC_Y0HI,x
    sta yp+1
    lda SC_STEPN,x          ; steps without the frames: the still's place
    beq :+
    lda haveframes
    bne :+
    lda SC_SXLO,x
    sta xp
    lda SC_SXHI,x
    sta xp+1
    lda SC_SYLO,x
    sta yp
    lda SC_SYHI,x
    sta yp+1
:   lda SC_PAGE0,x
    sta pgx
    lda SC_SET,x
    jsr set_flag
    ldx scene
    jsr cell                ; the new cell
    lda t2
    bne @dark
    lda cnew
    cmp fpic
    bne @dark
    lda cnx
    cmp t0
    bne @dark
    lda cny
    cmp t1
    beq @light
@dark:
    lda #BLANK
    sta blank
@light:
    lda #$fe                ; whatever the hidden buffer was being readied for, find it again
    sta tpic
    lda #0
    sta lscene
    rts

; The present pan's cell (picture, column ceil(x / 8), row floor(y / 8)) into cnew, cnx, cny. Keeps X.
cell:
    ldy scene
    lda SC_PIC,y
    sta cnew
    lda SC_STEPN,y          ; steps: the frame (from the last, backwards)
    beq @pan
    lda haveframes          ; (without the frames: the still, if any, as a pan)
    bne :+
    lda SC_STILL,y
    cmp #$ff
    beq @pan
    sta cnew
    jmp @pan
:   lda SC_REV,y
    beq :+
    lda SC_STEPN,y
    sec
    sbc #1
    sbc sframe
    jmp :++
:   lda sframe
:   clc
    adc SC_STEPB,y
    sta cnew
@pan:
    lda xp
    clc
    adc #7
    sta cnx
    lda xp+1
    adc #0
    lsr
    ror cnx
    lsr
    ror cnx
    lsr
    ror cnx
    lda yp+1
    sta cny
    lda yp
    lsr cny
    ror
    lsr cny
    ror
    lsr cny
    ror
    sta cny
    rts

; ------------------------------------------------------------------ the next frame
; The scrolls, the window's flip if its cell changed, and the text rows, for the top IRQ.
frame:
    jsr cell
    lda cnx                 ; x fine scroll: column * 8 - x
    asl
    asl
    asl
    sec
    sbc xp
    and #7
    ora #$10
    sta p_d016
    lda yp                  ; y: 7 - (y & 7)
    and #7
    eor #7
    ora #D011_WIN
    ldx blank
    bne @dark
    ldx cnew                ; (a frame, without an REU: dark too)
    ldy PIC_FRAME,x
    iny
    beq :+
    ldx haveframes
    bne :+
@dark:
    ora #D011_DARK
:   sta p_d011
    lda cnew                ; a new cell: flip to the hidden buffer if it is ready
    cmp fpic
    bne @new
    lda cnx
    cmp fcx
    bne @new
    lda cny
    cmp fcy
    beq @text
@new:
    lda flipwait
    bne @text
    lda cnew
    cmp hpic
    bne @text               ; (not ready: dark, or a late frame)
    lda cnx
    cmp hcx
    bne @text
    lda cny
    cmp hcy
    bne @text
    sta fcy
    lda hcx
    sta fcx
    lda hpic
    sta fpic
    lda #$ff
    sta hpic
    lda #1
    sta p_flip
    sta colpend
    sta flipwait
    lda #$fe
    sta tpic
@text:
    jsr text_rows
    lda #1
    sta ready
    rts

; Redraws the text rows whose content changed into TEXTBUF, and marks them for the top IRQ.
text_rows:
    lda #0
    sta tdirty
    sta tdirty+1
    lda scene               ; a new scene: every row
    cmp s_scene
    beq :+
    sta s_scene
    lda #$ff
    sta s_page
    sta s_ch
    jsr row_speaker
:   lda page                ; the text: a new page, or more of it shown
    cmp s_page
    bne :+
    lda shown
    cmp s_shown
    beq @choices
:   lda page
    sta s_page
    lda shown
    sta s_shown
    jsr rows_text
@choices:
    jsr choice_sig          ; the choices and the prompt
    cmp s_ch
    bne :+
    lda sel
    cmp s_sel
    bne :+
    lda flags
    cmp s_fl
    bne :+
    lda flags+1
    cmp s_fl+1
    bne :+
    lda t3
    cmp s_pr
    beq @mark
:   jsr choice_sig
    sta s_ch
    lda t3
    sta s_pr
    lda sel
    sta s_sel
    lda flags
    sta s_fl
    lda flags+1
    sta s_fl+1
    jsr rows_choices
@mark:
    sei                     ; (the top IRQ reads dirty)
    lda dirty
    ora tdirty
    sta dirty
    lda dirty+1
    ora tdirty+1
    sta dirty+1
    cli
    rts

; A: whether the choices show (1) or not (0); t3: whether the prompt shows.
choice_sig:
    lda #0
    sta t3
    ldx blank
    bne @none
    lda phase
    cmp #2
    beq @yes
    cmp #1
    beq @prompt
    cmp #3
    bne @none
@prompt:
    lda clock
    and #16
    beq @none
    lda #1
    sta t3
@none:
    lda #0
    rts
@yes:
    lda #1
    rts

; Row 0: the speaker.
row_speaker:
    ldx #0
    jsr clear_row
    ldx scene
    lda SC_SPK_LO,x
    sta ptr
    lda SC_SPK_HI,x
    sta ptr+1
    ldy #0
    lda (ptr),y
    tax
    ldy #0
:   cpx #0
    beq :+
    iny
    lda (ptr),y
    sta (rp),y              ; (column y, as the length comes first)
    dex
    jmp :-
:   lda tdirty
    ora #1
    sta tdirty
    rts

; Rows 1-4: the page's lines, as much as is shown.
rows_text:
    lda shown
    sta t2                  ; letters left to show
    lda pgx                 ; the page's first line: LN index pgx * 4
    asl
    asl
    sta t0
    lda #1
    sta t1                  ; the row
@line:
    ldx t1
    jsr clear_row           ; (rp: the row)
    ldx t0
    lda LN_LO,x
    sta ptr
    lda LN_HI,x
    sta ptr+1
    ldy #0
    lda (ptr),y             ; as much of the line as is shown: its length, or the letters left
    cmp t2
    bcc :+
    lda t2
:   beq @end
    tax
    eor #$ff                ; letters left -= that
    sec
    adc t2
    sta t2
@ch:
    iny                     ; letter y of the line goes in column y (from 1)
    lda (ptr),y
    sta (rp),y
    dex
    bne @ch
@end:
    inc t0
    inc t1
    lda t1
    cmp #5
    bne @line
    lda tdirty
    ora #%00011110
    sta tdirty
    rts

; Rows 5-8: the choices, the chosen one reversed; and the prompt.
rows_choices:
    ldx #5
:   jsr clear_row
    inx
    cpx #9
    bne :-
    jsr choice_sig
    beq @prompt
    jsr list_choices
    lda #0
    sta t0                  ; the choice shown
@one:
    lda t0
    cmp nch
    bcs @prompt
    tax
    ldy chl,x
    lda CH_TXT_LO,y
    sta ptr
    lda CH_TXT_HI,y
    sta ptr+1
    lda t0
    clc
    adc #5
    tax
    jsr row_ptr
    clc                     ; letter k (from 1) goes in column k + 2: the row pointer + 2
    lda rp
    adc #2
    sta dst
    lda rp+1
    adc #0
    sta dst+1
    ldy #0
    lda (ptr),y
    sta t3
@ch:
    lda t3
    beq @rev
    iny
    lda (ptr),y
    sta (dst),y
    dec t3
    jmp @ch
@rev:
    lda t0                  ; the chosen one: columns 1-38 reversed
    cmp sel
    bne @next
    clc
    adc #5
    tax
    jsr reverse_row
@next:
    inc t0
    jmp @one
@prompt:
    jsr choice_sig          ; (t3: the prompt)
    lda t3
    beq @mark
    lda #PROMPT
    sta TEXTBUF + 8 * 40 + 38
@mark:
    lda tdirty
    ora #%11100000
    sta tdirty
    lda tdirty+1
    ora #1
    sta tdirty+1
    rts

; rp: row X of TEXTBUF. Keeps X.
row_ptr:
    lda TBUF_LO,x
    sta rp
    lda TBUF_HI,x
    sta rp+1
    rts

; Row X of TEXTBUF all spaces, and rp it. Keeps X.
clear_row:
    jsr row_ptr
    ldy #39
    lda #$20
:   sta (rp),y
    dey
    bpl :-
    rts

; Row X's columns 1-38 reversed (codes + 64).
reverse_row:
    jsr row_ptr
    ldy #38
:   lda (rp),y
    ora #$40
    sta (rp),y
    dey
    bne :-
    rts

; ------------------------------------------------------------------ readying the window
; Between ticks: find the next cell the pan will need (running it on), then copy it into the hidden
; buffer a row at a time.
work:
    lda flipwait            ; (the hidden buffer may still be showing until the top IRQ flips)
    beq :+
    rts
:   lda tpic
    cmp #$fe
    bne @copy
    jmp look
@copy:
    cmp #$ff
    beq @idle
    lda crow
    cmp climit
    bcc :+
@idle:
    rts
:   jmp copy_row

; The target: if the window needs another cell now (a scene that moved it), that; otherwise the cell
; the pan reaches next, running it on from the present 32 ticks at a time.
look:
    lda lscene
    bne @run
    jsr cell                ; the present cell: needed and not showing?
    lda cnew
    cmp fpic
    bne @take
    lda cnx
    cmp fcx
    bne @take
    lda cny
    cmp fcy
    bne @take
    ldx scene               ; no: steps: the next frame, if there is one
    lda haveframes
    beq @pan
    lda SC_STEPN,x
    beq @pan
    sec
    sbc #1
    cmp sframe
    beq @last
    inc sframe
    jsr cell
    dec sframe
    jmp target
@last:
    lda #$ff
    sta tpic
    rts
@pan:
    lda scene               ; or start running the pan on from here
    sta lscene
    inc lscene              ; (lscene is the scene + 1; 0 means not started)
    lda xf
    sta lxf
    lda xp
    sta lxp
    lda xp+1
    sta lxp+1
    lda yf
    sta lyf
    lda yp
    sta lyp
    lda yp+1
    sta lyp+1
    lda pt
    sta lt
    lda pt+1
    sta lt+1
    rts
@take:
    jmp target
@run:
    lda #32
    sta t2
@step:
    ldx lscene
    dex
    lda lt
    cmp SC_TLO,x
    lda lt+1
    sbc SC_THI,x
    bcc :+
    lda #$ff                ; the pan ends without another cell: nothing to ready
    sta tpic
    rts
:   inc lt
    bne :+
    inc lt+1
:   clc
    lda lxf
    adc SC_DXLO,x
    sta lxf
    lda SC_DXHI,x
    jsr sext
    adc lxp
    sta lxp
    tya
    adc lxp+1
    sta lxp+1
    clc
    lda lyf
    adc SC_DYLO,x
    sta lyf
    lda SC_DYHI,x
    jsr sext
    adc lyp
    sta lyp
    tya
    adc lyp+1
    sta lyp+1
    lda lxp                 ; its cell
    clc
    adc #7
    sta cnx
    lda lxp+1
    adc #0
    lsr
    ror cnx
    lsr
    ror cnx
    lsr
    ror cnx
    lda lyp+1
    sta cny
    lda lyp
    lsr cny
    ror
    lsr cny
    ror
    lsr cny
    ror
    sta cny
    lda cnx
    cmp fcx
    bne @found
    lda cny
    cmp fcy
    bne @found
    dec t2
    beq :+
    jmp @step
:   rts
@found:
    lda SC_PIC,x
    sta cnew
target:
    lda cnew
    sta tpic
    lda cnx
    sta tcx
    lda cny
    sta tcy
    lda #0
    sta crow
    sta cphase
    sta lscene
    ldx tpic
    lda PIC_FRAME,x
    cmp #$ff
    lda #15
    bcs :+
    lda #17
:   sta climit
    rts

; Copies row crow (0-14) of the target's window into the hidden buffer: 320 bitmap bytes, 40 screen bytes,
; and 40 colours into COLBUF.
copy_row:
    ldx tpic                ; a frame: from the REU
    lda PIC_FRAME,x
    cmp #$ff
    beq :+
    jmp copy_frame
:   ldx tpic
    lda PIC_ROW0,x
    clc
    adc tcy
    adc crow
    tax                     ; X: the picture's row in ROW_*
    lda cphase              ; in six steps, so a tick never waits long behind one: the bitmap's 320
    beq @first              ; bytes 64 at a time, then the screen row and the colours
    cmp #5
    beq @attrs
    lda #1
    sta t2
    jsr @run
    inc cphase
    rts
@first:
    lda tcx                 ; the column's offset: x8 for the bitmap, x1 for the others
    sta t0
    lda #0
    sta t1
    asl t0
    rol t1
    asl t0
    rol t1
    asl t0
    rol t1
    clc
    lda ROW_BM_LO,x
    adc t0
    sta @b0+1
    lda ROW_BM_HI,x
    adc t1
    sta @b0+2
    clc                     ; the hidden bitmap's row: base + crow * 320
    ldy crow
    lda ROW320LO,y
    sta @d0+1
    lda ROW320HI,y
    ldy front
    ora HIDBMP,y
    sta @d0+2
    ; 320 bytes, as 5 runs of 64 (self-modified addresses advance by 64 each run), one a step
    lda #1
    sta t2
    jsr @run
    inc cphase
    rts
@run:
    ldy #63
@b0:
    lda $ffff,y
@d0:
    sta $ffff,y
    dey
    bpl @b0
    clc
    lda @b0+1
    adc #64
    sta @b0+1
    bcc :+
    inc @b0+2
:   clc
    lda @d0+1
    adc #64
    sta @d0+1
    bcc :+
    inc @d0+2
:   dec t2
    bne @run
    rts
@attrs:                     ; the screen row and the colours
    lda #0
    sta cphase
    clc
    lda ROW_SC_LO,x
    adc tcx
    sta src
    lda ROW_SC_HI,x
    adc #0
    sta src+1
    ldy crow
    lda ROW40W_LO,y
    sta dst
    lda ROW40W_HI,y
    ldy front
    ora HIDSCR,y
    sta dst+1
    ldy #39
:   lda (src),y
    sta (dst),y
    dey
    bpl :-
    clc
    lda ROW_CO_LO,x
    adc tcx
    sta src
    lda ROW_CO_HI,x
    adc #0
    sta src+1
    ldy crow
    clc
    lda ROW40W_LO,y
    adc #<COLBUF
    sta dst
    lda ROW40W_HI,y
    adc #>COLBUF
    sta dst+1
    ldy #39
:   lda (src),y
    sta (dst),y
    dey
    bpl :-
    inc crow
    lda crow
    cmp #15
    bne :+
    lda tpic                ; done: the hidden buffer holds the target
    sta hpic
    lda tcx
    sta hcx
    lda tcy
    sta hcy
:   rts

; A frame's step crow (0-16) by DMA from the REU: bitmap rows 0-14, then the screen, then the colours.
; Each takes 5 to 10 lines with the CPU stopped, so none starts near the split (or its IRQ would be
; late). Without the frames, the buffer just counts as ready (the window is dark for them).
copy_frame:
    tax                     ; X: the frame
    lda haveframes
    bne :+
    jmp @done
:   lda $d011               ; not from line 140 to 180
    bmi @go
    lda $d012
    cmp #140
    bcc @go
    cmp #181
    bcs @go
    rts
@go:
    lda #0
    sta REU_CTRL
    lda crow
    cmp #15
    bcs @attrs
    tay                     ; bitmap row crow: 320 bytes at crow * 320
    lda ROW320LO,y
    sta t0
    lda ROW320HI,y
    sta t1
    sta t2
    lda t0
    sta REU_C64
    lda t2
    ldy front
    ora HIDBMP,y
    sta REU_C64+1
    lda #<320
    sta REU_LEN
    lda #>320
    sta REU_LEN+1
    jmp @fetch
@attrs:
    bne @colours
    lda #0                  ; the screen: 600 bytes at 4800
    sta REU_C64
    ldy front
    lda HIDSCR,y
    sta REU_C64+1
    lda #<4800
    sta t0
    lda #>4800
    sta t1
    jmp @600
@colours:
    lda #<COLBUF            ; the colours: 600 bytes at 5400
    sta REU_C64
    lda #>COLBUF
    sta REU_C64+1
    lda #<5400
    sta t0
    lda #>5400
    sta t1
@600:
    lda #<600
    sta REU_LEN
    lda #>600
    sta REU_LEN+1
@fetch:
    clc                     ; the REU address: the frame's + the part's
    lda FR_A0,x
    adc t0
    sta REU_ADDR
    lda FR_A1,x
    adc t1
    sta REU_ADDR+1
    lda FR_A2,x
    adc #0
    sta REU_ADDR+2
    lda #$91                ; fetch, now
    sta REU_CMD
    inc crow
    lda crow
    cmp #17
    bne @rts
@done:
    lda climit              ; (the copy loop's "finished")
    sta crow
    lda tpic
    sta hpic
    lda tcx
    sta hcx
    lda tcy
    sta hcy
@rts:
    rts

; Start-up, with the KERNAL: if there is an REU, each frame file from this program's disk into $A000,
; then out to the REU; FRAMES_OK 1 if all are there.
load_frames:
    lda #0
    sta FRAMES_OK
.if NFRAMES > 0
    lda #$a5                ; an REU keeps what is written to its address registers
    sta REU_C64
    lda #$3c
    sta REU_C64+1
    lda REU_C64
    cmp #$a5
    bne @fail
    lda REU_C64+1
    cmp #$3c
    bne @fail
    lda #$5a
    sta REU_C64
    lda REU_C64
    cmp #$5a
    bne @fail
    jmp @found
@fail:
    jmp @none
@found:
    lda #0                  ; frames already there (an REU image)? fetch the signature after them
    sta REU_CTRL
    lda #<SIGBUF
    sta REU_C64
    lda #>SIGBUF
    sta REU_C64+1
    lda #SIG_A0
    sta REU_ADDR
    lda #SIG_A1
    sta REU_ADDR+1
    lda #SIG_A2
    sta REU_ADDR+2
    lda #12
    sta REU_LEN
    lda #0
    sta REU_LEN+1
    lda #$91
    sta REU_CMD
    ldx #11
:   lda SIGBUF,x
    cmp FR_SIG,x
    bne @load
    dex
    bpl :-
    jmp @have
@load:
    ldx #0
@msg:
    lda LOADING,x
    beq :+
    jsr $ffd2
    inx
    bne @msg
:   lda #0
    sta t0
@one:
    ldx t0
    lda FRN_LEN,x
    pha
    ldy FRN_HI,x
    lda FRN_LO,x
    tax
    pla
    jsr $ffbd               ; SETNAM
    lda #1
    ldx $ba                 ; the drive this program came from (8 if none)
    cpx #8
    bcs :+
    ldx #8
:   ldy #0
    jsr $ffba               ; SETLFS: load where we say
    lda #0
    ldx #<LOADBUF
    ldy #>LOADBUF
    jsr $ffd5               ; LOAD
    bcs @none
    lda #'.'
    jsr $ffd2
    ldx t0
    sei                     ; (the REU reads what the CPU would: BASIC out of the way)
    lda #$36
    sta $01
    lda #0
    sta REU_CTRL
    lda #<LOADBUF
    sta REU_C64
    lda #>LOADBUF
    sta REU_C64+1
    lda FR_A0,x
    sta REU_ADDR
    lda FR_A1,x
    sta REU_ADDR+1
    lda FR_A2,x
    sta REU_ADDR+2
    lda #<FRAME_BYTES
    sta REU_LEN
    lda #>FRAME_BYTES
    sta REU_LEN+1
    lda #$90                ; stash, now
    sta REU_CMD
    lda #$37
    sta $01
    cli
    inc t0
    lda t0
    cmp #NFRAMES
    bne @one
@have:
    lda #1
    sta FRAMES_OK
.endif
@none:
    rts

.segment "RODATA"
LOADING: .byte 13, "LOADING THE PICTURES", 0
BANKS:   .byte %11, %01     ; $DD00 for banks 0 and 2
HIDBMP:  .byte >BMP_B, >BMP_A ; the hidden bitmap and screen, by the front buffer
HIDSCR:  .byte >SCR_B, >SCR_A
ROW320LO:
.repeat 15, I
    .byte <(I * 320)
.endrepeat
ROW320HI:
.repeat 15, I
    .byte >(I * 320)
.endrepeat
ROW40W_LO:
.repeat 16, I
    .byte <(I * 40)
.endrepeat
ROW40W_HI:
.repeat 16, I
    .byte >(I * 40)
.endrepeat
TBUF_LO:
.repeat 9, I
    .byte <(TEXTBUF + I * 40)
.endrepeat
TBUF_HI:
.repeat 9, I
    .byte >(TEXTBUF + I * 40)
.endrepeat
TSCR_LO:
.repeat 9, I
    .byte <(TROW + I * 40)
.endrepeat
TSCR_HI:
.repeat 9, I
    .byte >(TROW + I * 40)
.endrepeat
BITLO:   .byte 1, 2, 4, 8, 16, 32, 64, 128, 0, 0, 0, 0, 0, 0, 0, 0
BITHI:   .byte 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 4, 8, 16, 32, 64, 128

.segment "FONT"
    .incbin "font.bin"

.include "pics.inc"
