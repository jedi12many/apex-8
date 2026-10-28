; APEX isometric dungeon for the Commodore 64: the hero walks a dungeon that scrolls smoothly in every
; direction under a torchlight that stays with them, at 50 frames a second. It follows the reference
; (core/iso.js, c64/iso/view.js) step for step, so every frame is exactly the reference's frame.
;
; The screen is 38 x 24 multicolor characters, moved by the VIC's fine scroll in both directions; the
; hero is a sprite that never moves. Each character is looked up: its phase on the 2:1 grid and its
; anchor tile give a byte of the code maps (c64/iso/gen.js). When the view moves a whole character,
; the screen that isn't showing becomes the other one shifted by a character (an unrolled copy), the
; light's half-lit bits that the shift got wrong are flipped back, and the new edge row or column is
; looked up; then the screens swap at the bottom of the frame together with the fine scroll.
;
; Controls: joystick in port 2, or W / A / S / D (two at once for diagonals); R restarts.
; Assemble with c64/iso/build.js. The machine set-up, scripts and timing come from the kit
; (c64/kit/kit.inc).

.include "gen.inc"
.include "kit.inc"

SCREEN_A = $0400
SCREEN_B = $3000
SPRITES  = $3400
CHARSET  = $3800
D018_A   = $1e              ; screen $0400, characters $3800
D018_B   = $ce              ; screen $3000, characters $3800
SPRPTR   = SPRITES / 64
IRQ_LINE = 250              ; below the 24-row display
HALF     = LIGHT + 1000     ; per screen character: $80 where the light is half-lit

.segment "ZEROPAGE"
hx:      .res 2             ; the hero, 8.8 tiles
hy:      .res 2
facing:  .res 1             ; 0 right, 1 left
frm:     .res 1             ; walk cycle, 0-15
moving:  .res 1
inp:     .res 1             ; joystick bits: 1 up, 2 down, 4 left, 8 right
ox:      .res 2             ; the hero before this tick
oy:      .res 2
clx:     .res 2             ; clear: the square's centre
cly:     .res 2
tx0:     .res 1             ; clear: its tile columns and rows
tx1:     .res 1
ty0:     .res 1
ty1:     .res 1
lp:      .res 2             ; clear: a row of the map
camx:    .res 2             ; the camera, screen-plane pixels
camy:    .res 2
xs:      .res 1             ; fine scroll
ys:      .res 1
cx:      .res 1             ; the screen's first character, screen-plane characters (signed)
cy:      .res 1
fcx:     .res 1             ; the same for the screen drawn last
fcy:     .res 1
mdx:     .res 1             ; how far the view moved, in characters
mdy:     .res 1
front:   .res 1             ; the screen drawn last: 0 A, 1 B
back:    .res 2             ; the screen being drawn
lcx:     .res 1             ; a line of characters: its first character
lcy:     .res 1
rn:      .res 1             ; (2n + 3) & 7, n = cx + 2 cy: gives the phase
rm:      .res 1             ; (2m + 1) & 7, m = 2 cy - cx
ax:      .res 1             ; the anchor column (+ OFFX)
cptr:    .res 2             ; the anchor row of the code maps
dptr:    .res 2             ; a column's next character, and its half-lit bit
hptr:    .res 2
pa:      .res 1             ; a column's code map columns: its even rows' phase, and its odd rows'
pb:      .res 1
jv:      .res 2             ; a routine to call through
t0:      .res 1
t1:      .res 1
t2:      .res 1
sa:      .res 1             ; registers saved by the IRQ
sx:      .res 1
sy:      .res 1
ready:   .res 1             ; 1: the next frame is worked out (p_*)
applied: .res 1             ; 1: the IRQ showed it
p_d018:  .res 1             ; the next frame
p_d016:  .res 1
p_d011:  .res 1
p_ptr:   .res 1

.segment "CODE"
start:
    KIT_INIT irq
    lda #COL_BORDER
    sta $d020
    lda #COL_BG
    sta $d021
    lda #COL_MC1
    sta $d022
    lda #COL_MC2
    sta $d023
    ldx #0                  ; colour RAM: the light's colours, for good
:   lda LIGHT,x
    sta $d800,x
    lda LIGHT+250,x
    sta $d800+250,x
    lda LIGHT+500,x
    sta $d800+500,x
    lda LIGHT+750,x
    sta $d800+750,x
    inx
    cpx #250
    bne :-
    lda #1                  ; the hero: one multicolor sprite in the middle of the screen
    sta $d015
    sta $d01c
    lda #0
    sta $d017
    sta $d01d
    sta $d01b
    sta $d010
    lda #SPR_X
    sta $d000
    lda #SPR_Y
    sta $d001
    lda #SPR_MC1
    sta $d025
    lda #SPR_MC2
    sta $d026
    lda #SPR_COLOR
    sta $d027

    lda #1                  ; the first frame goes to screen A
    sta front
    lda #$80                ; (no screen drawn yet: a whole redraw)
    sta fcx
    KIT_SCRIPT_START
    jsr reset_hero
    jsr view
    jsr apply

    lda #IRQ_LINE + 2       ; start just after the bottom of a frame, so the first frame has a whole
:   cmp $d012               ; frame's time like every other
    bne :-
    KIT_TIMER_START         ; and time it from there
    lda #0
    sta maxcyc
    sta maxcyc+1
    lda #IRQ_LINE
    sta $d012
    lda #1
    sta $d01a
    sta $d019
    sta counting
    cli

main:
    lda applied             ; wait for the last frame to show
    beq main
    KIT_TIMER_START         ; time this frame's work
    lda #0
    sta applied
    jsr input
    bcc :+
    jmp kit_park
:   jsr tick
    jsr view
    jmp main

; ------------------------------------------------------------------ controls
; inp from the joystick in port 2 and W / A / S / D; C set when a SCRIPT build's script has ended.
input:
.ifdef SCRIPT
    jmp kit_script
.else
    lda #$ff                ; no keyboard row: $DC00 reads the joystick
    sta $dc00
    lda $dc00
    eor #$ff
    and #15
    sta inp
    lda #%11111101          ; keyboard row 1: W (bit 1), A (2), S (5)
    sta $dc00
    lda $dc01
    eor #$ff
    sta t0
    and #2
    beq :+
    lda inp
    ora #1
    sta inp
:   lda t0
    and #4
    beq :+
    lda inp
    ora #4
    sta inp
:   lda t0
    and #$20
    beq :+
    lda inp
    ora #2
    sta inp
:   lda #%11111011          ; row 2: R (bit 1), D (2)
    sta $dc00
    lda $dc01
    eor #$ff
    sta t0
    lda #$ff
    sta $dc00
    lda t0
    and #4
    beq :+
    lda inp
    ora #8
    sta inp
:   lda t0
    and #2
    beq :+
    jsr reset_hero          ; R: start again
    lda #$80
    sta fcx
:   clc
    rts
.endif

; ------------------------------------------------------------------ the hero (core/iso.js)
reset_hero:
    lda #<START_X
    sta hx
    lda #>START_X
    sta hx+1
    lda #<START_Y
    sta hy
    lda #>START_Y
    sta hy+1
    lda #0
    sta facing
    sta frm
    sta moving
    rts

; One frame: step along x, then along y, each only if the hero's square stays on floor.
tick:
    lda hx
    sta ox
    lda hx+1
    sta ox+1
    lda hy
    sta oy
    lda hy+1
    sta oy+1
    lda inp
    and #15
    tax
    lda DIR_X,x             ; x: clear(x + dx, y)?
    beq @y
    ldy #0
    ora #0
    bpl :+
    dey
:   clc
    adc hx
    sta clx
    tya
    adc hx+1
    sta clx+1
    lda hy
    sta cly
    lda hy+1
    sta cly+1
    stx t2
    jsr clear
    ldx t2
    bcs @y
    lda clx
    sta hx
    lda clx+1
    sta hx+1
@y:
    lda DIR_Y,x             ; y: clear(x, y + dy)?
    beq @face
    ldy #0
    ora #0
    bpl :+
    dey
:   clc
    adc hy
    sta cly
    tya
    adc hy+1
    sta cly+1
    lda hx
    sta clx
    lda hx+1
    sta clx+1
    stx t2
    jsr clear
    ldx t2
    bcs @face
    lda cly
    sta hy
    lda cly+1
    sta hy+1
@face:
    lda DIR_FACE,x          ; 1 right, 2 left, 0 as before
    beq @moved
    sec
    sbc #1
    sta facing
@moved:
    lda hx                  ; moving: the position changed
    cmp ox
    bne @walk
    lda hx+1
    cmp ox+1
    bne @walk
    lda hy
    cmp oy
    bne @walk
    lda hy+1
    cmp oy+1
    bne @walk
    lda #0
    sta moving
    sta frm
    rts
@walk:
    lda #1
    sta moving
    lda frm
    clc
    adc #1
    and #15
    sta frm
    rts

; C clear if the square RADIUS each way from (clx, cly) is all on floor (looks 1 and 2).
clear:
    lda clx
    sec
    sbc #RADIUS
    lda clx+1
    sbc #0
    sta tx0
    lda clx
    clc
    adc #RADIUS - 1
    lda clx+1
    adc #0
    sta tx1
    lda cly
    sec
    sbc #RADIUS
    lda cly+1
    sbc #0
    sta ty0
    lda cly
    clc
    adc #RADIUS - 1
    lda cly+1
    adc #0
    sta ty1
    lda ty0
    jsr @row
    bcs @done
    lda ty1
@row:                       ; row A: columns tx0 and tx1
    sta t0
    lsr
    lsr
    clc
    adc #>LOOKS
    sta lp+1
    lda t0
    and #3
    lsr
    ror
    ror
    sta lp                  ; (row & 3) * 64
    ldy tx0
    lda (lp),y
    sec
    sbc #1
    cmp #2
    bcs @done
    ldy tx1
    lda (lp),y
    sec
    sbc #1
    cmp #2
@done:
    rts

; ------------------------------------------------------------------ the next frame
; Works out the camera, brings the screen that isn't showing up to date if the view moved a whole
; character, and leaves the registers for the IRQ.
view:
    ; camx = ((hx - hy) >> 4) - HERO_X, signed
    lda hx
    sec
    sbc hy
    sta t0
    lda hx+1
    sbc hy+1
    ldx #4
:   cmp #$80
    ror
    ror t0
    dex
    bne :-
    sta t1
    lda t0
    sec
    sbc #<HERO_X
    sta camx
    lda t1
    sbc #>HERO_X
    sta camx+1
    ; camy = ((hx + hy) >> 5) - HERO_Y
    lda hx
    clc
    adc hy
    sta t0
    lda hx+1
    adc hy+1
    ldx #5
:   lsr
    ror t0
    dex
    bne :-
    sta t1
    lda t0
    sec
    sbc #<HERO_Y
    sta camy
    lda t1
    sbc #>HERO_Y
    sta camy+1
    ; xs = -camx & 7, cx = (camx + xs) >> 3
    lda camx
    eor #$ff
    clc
    adc #1
    and #7
    sta xs
    clc
    adc camx
    sta t0
    lda camx+1
    adc #0
    ldx #3
:   cmp #$80
    ror
    ror t0
    dex
    bne :-
    lda t0
    sta cx
    ; ys = (3 - camy) & 7, cy = (camy + ys - 3) >> 3
    lda #3
    sec
    sbc camy
    and #7
    sta ys
    sec
    sbc #3
    tay                     ; (ys - 3, -3 to 4: sign-extend)
    ldx #0
    cmp #$80
    bcc :+
    dex
:   tya
    clc
    adc camy
    sta t0
    txa
    adc camy+1
    ldx #3
:   cmp #$80
    ror
    ror t0
    dex
    bne :-
    lda t0
    sta cy

    ; how far the screen moved since the last one drawn
    lda fcx
    cmp #$80
    beq @whole
    lda cx
    sec
    sbc fcx
    sta mdx
    lda cy
    sec
    sbc fcy
    sta mdy
    ora mdx
    bne :+
    jmp @regs               ; the same: only the fine scroll changes
:   lda mdx
    clc
    adc #1
    cmp #3
    bcs @whole
    lda mdy
    clc
    adc #1
    cmp #3
    bcs @whole
    jsr flip
    jsr shift
    jmp @drawn
@whole:
    jsr flip
    jsr redraw
@drawn:
    lda cx
    sta fcx
    lda cy
    sta fcy
@regs:
    ldx front
    lda D018S,x
    sta p_d018
    lda xs
    ora #$10                ; multicolor, 38 columns
    sta p_d016
    lda ys
    ora #$10                ; screen on, 24 rows
    sta p_d011
    ; the sprite's frame: standing, or one of two walking; mirrored facing left
    ldx #0
    lda moving
    beq :+
    inx
    lda frm
    and #4
    beq :+
    inx
:   txa
    ldx facing
    beq :+
    clc
    adc #3
:   clc
    adc #SPRPTR
    sta p_ptr

    lda #1
    sta ready
:   ldx $dc05               ; how long the work took
    lda $dc04
    cpx $dc05
    bne :-
    eor #$ff
    sta t0
    txa
    eor #$ff
    tax
    lda t0
    cmp maxcyc
    txa
    sbc maxcyc+1
    bcc :+
    lda t0
    sta maxcyc
    stx maxcyc+1
:   rts

; The other screen becomes the one to draw into (back) and to show next (front).
flip:
    lda front
    eor #1
    sta front
    tax
    lda SCREENS_LO,x
    sta back
    lda SCREENS_HI,x
    sta back+1
    rts

; The back screen = the front one moved by (mdx, mdy) characters: copy, fix the light's half-lit
; bits, then look up the new edges.
shift:
    lda mdy                 ; i = (dy + 1) * 3 + dx + 1
    clc
    adc #1
    sta t0
    asl
    adc t0
    sec                     ; (+ dx + 1)
    adc mdx
    tay
    sty t0
    ldx front
    beq :+
    lda COPY_B_LO,y
    sta jv
    lda COPY_B_HI,y
    sta jv+1
    jmp @copy
:   lda COPY_A_LO,y
    sta jv
    lda COPY_A_HI,y
    sta jv+1
@copy:
    jsr call
    ldy t0                  ; the fixups: list k, from X = 0, or X = D for the opposite direction
    lda FIXK,y
    ldx front
    beq :+
    clc
    adc #4
:   tax
    lda FIX_LO,x
    sta jv
    lda FIX_HI,x
    sta jv+1
    ldx FIXX,y
    jsr call
    lda mdx                 ; a new column on the side the view moved to
    beq @rows
    bmi :+
    lda #38
    jsr draw_col
    jmp @rows
:   lda #0
    jsr draw_col
@rows:
    lda mdy                 ; and a new row
    beq @done
    bmi :+
    lda #24
    jmp draw_row
:   lda #0
    jmp draw_row
@done:
    rts

call:
    jmp (jv)

; The whole back screen, row by row.
redraw:
    lda #0
    sta t2
:   lda t2
    jsr draw_row
    inc t2
    lda t2
    cmp #25
    bne :-
    rts

; Line set-up for the character (lcx, lcy): rn, rm, the anchor column ax and row cptr.
line:
    lda lcy                 ; n = cx + 2 cy, kept in t0/t1
    sta t0
    ldx #0
    cmp #$80
    bcc :+
    dex
:   stx t1
    asl t0
    rol t1
    ldx #0
    lda lcx
    bpl :+
    dex
:   clc
    adc t0
    sta t0
    txa
    adc t1
    sta t1
    asl t0                  ; 2n + 3
    rol t1
    lda t0
    clc
    adc #3
    sta t0
    bcc :+
    inc t1
:   and #7
    sta rn
    lda t1                  ; ax = (2n + 3) >> 3 + OFFX
    ldx #3
:   cmp #$80
    ror
    ror t0
    dex
    bne :-
    lda t0
    clc
    adc #OFFX
    sta ax
    lda lcy                 ; m = 2 cy - cx
    sta t0
    ldx #0
    cmp #$80
    bcc :+
    dex
:   stx t1
    asl t0
    rol t1
    ldx #0
    lda lcx
    bpl :+
    dex
:   stx t2
    eor #$ff                ; (t0/t1 - cx: add its complement + 1)
    sec
    adc t0
    sta t0
    lda t2
    eor #$ff
    adc t1
    sta t1
    asl t0                  ; 2m + 1
    rol t1
    lda t0
    ora #1
    sta t0
    and #7
    sta rm
    lda t1                  ; the anchor row: (2m + 1) >> 3 + OFFY
    ldx #3
:   cmp #$80
    ror
    ror t0
    dex
    bne :-
    lda t0
    clc
    adc #OFFY + >CMAP
    sta cptr+1
    lda #0
    sta cptr
    rts

; Row A of the back screen, all 39 characters. Across a row the phases go 0, 1, 2, 3; the code map
; row moves up after each phase 0 and the anchor column on after each phase 2.
draw_row:
    sta t2
    clc
    adc cy
    sta lcy
    lda cx
    sta lcx
    ldx t2                  ; patch in the row's half-lit bits and its place on the screen
    lda ROW40_LO,x
    clc
    adc #<HALF
    sta @h0+1
    sta @h1+1
    sta @h2+1
    sta @h3+1
    lda ROW40_HI,x
    adc #>HALF
    sta @h0+2
    sta @h1+2
    sta @h2+2
    sta @h3+2
    lda ROW40_LO,x
    clc
    adc back
    sta @p0+1
    sta @p1+1
    sta @p2+1
    sta @p3+1
    lda ROW40_HI,x
    adc back+1
    sta @p0+2
    sta @p1+2
    sta @p2+2
    sta @p3+2
    lda t2
    pha
    jsr line
    pla
    sta t2
    ldx #0
    ldy rn                  ; start at the first character's phase
    lda PHASE,y
    beq @c0
    cmp #2
    bcc @c1
    beq @c2
    bcs @c3
@c0:
    ldy ax
    lda (cptr),y
@h0:
    ora $ffff,x
@p0:
    sta $ffff,x
    dec cptr+1
    inx
    cpx #39
    beq @done
@c1:
    lda ax
    ora #64
    tay
    lda (cptr),y
@h1:
    ora $ffff,x
@p1:
    sta $ffff,x
    inx
    cpx #39
    beq @done
@c2:
    lda ax
    ora #128
    tay
    lda (cptr),y
@h2:
    ora $ffff,x
@p2:
    sta $ffff,x
    inc ax
    inx
    cpx #39
    beq @done
@c3:
    lda ax
    ora #192
    tay
    lda (cptr),y
@h3:
    ora $ffff,x
@p3:
    sta $ffff,x
    inx
    cpx #39
    bne @c0
@done:
    rts

; Column A of the back screen, all 25 characters (col.inc).
draw_col:
    sta t2
    clc
    adc cx
    sta lcx
    lda cy
    sta lcy
    lda t2
    pha
    jsr line
    ldy rn                  ; the two phases down the column, as code map columns
    lda PHCOL,y
    sta pa
    eor #128
    sta pb
    lda PHASE,y
    tay
    lda COLPAR,y
    ldx front
    beq :+
    ora #2
:   tax
    lda COL_LO,x
    sta jv
    lda COL_HI,x
    sta jv+1
    pla
    tax
    jmp (jv)

.include "col.inc"

; Shows the frame view worked out. Called at the bottom of the frame.
apply:
    lda p_d018
    sta $d018
    lda p_d016
    sta $d016
    lda p_d011
    sta $d011
    lda p_ptr
    sta SCREEN_A + $3f8
    sta SCREEN_B + $3f8
    lda #0
    sta ready
    lda #1
    sta applied
    rts

; ------------------------------------------------------------------ the raster IRQ
; The bottom of the frame: the next frame if it's ready.
irq:
    sta sa
    stx sx
    sty sy
    lda ready
    beq @late
    jsr apply
    jmp @done
@late:
    KIT_LATE
@done:
    lda #1
    sta $d019
    lda sa
    ldx sx
    ldy sy
    rti

.segment "RODATA"
D018S:      .byte D018_A, D018_B
SCREENS_LO: .byte <SCREEN_A, <SCREEN_B
SCREENS_HI: .byte >SCREEN_A, >SCREEN_B
; the phase as a column of the code maps, by rn = (2n + 3) & 7 (always odd): 3 -> 0, 5 -> 1, 7 -> 2, 1 -> 3
PHCOL:      .byte 0, 3 * 64, 0, 0, 0, 1 * 64, 0, 2 * 64
ROW40_LO:
.repeat 25, I
    .byte <(I * 40)
.endrepeat
ROW40_HI:
.repeat 25, I
    .byte >(I * 40)
.endrepeat
; the fixups by (dy + 1) * 3 + dx + 1: which list (c64/iso/gen.js: k 0 (1,0), 1 (0,1), 2 (1,1),
; 3 (-1,1)), and X: 0, or its D for the opposite direction
FIXK:       .byte 2, 1, 3, 0, 0, 0, 3, 1, 2
FIXX:       .byte 41, 40, 39, 1, 0, 0, 0, 0, 0
FIX_LO:     .lobytes fix_0_a, fix_1_a, fix_2_a, fix_3_a, fix_0_b, fix_1_b, fix_2_b, fix_3_b
FIX_HI:     .hibytes fix_0_a, fix_1_a, fix_2_a, fix_3_a, fix_0_b, fix_1_b, fix_2_b, fix_3_b
; by phase: whether a column steps on after its odd rows (1) or its even rows (0, phases 1 and 2)
COLPAR:     .byte 1, 0, 0, 1
COL_LO:     .lobytes col_a_even, col_a_odd, col_b_even, col_b_odd
COL_HI:     .hibytes col_a_even, col_a_odd, col_b_even, col_b_odd
; the phase by rn = (2n + 3) & 7
PHASE:      .byte 3, 3, 0, 0, 1, 1, 2, 2

.segment "SPRITES"
    .incbin "sprites.bin"

.segment "CHARSET"
    .incbin "charset.bin"

.segment "HIGH"             ; page-aligned
CMAP:    .incbin "cmap.bin"
LOOKS:   .incbin "looks.bin"
LIGHT:   .incbin "light.bin"
.include "copy.inc"
.include "fix.inc"
