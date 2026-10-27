; APEX for the Commodore 64: a real-time raycaster drawn with APEXSCII's raycast character set.
;
; Each frame:
;   cast  80 rays with the reference raycaster's integer DDA (core/raycast.js), using the same tables,
;         so every ray's half wall height is exactly the reference value
;   draw  each pair of rays as screen codes into the screen that isn't showing (two screens, swapped
;         at the top of the frame, so drawing never shows)
;   show  the status panel below the view in the ROM font, through a raster split
;
; Controls: joystick in port 2 or W/S to walk, A/D or joystick left/right to turn.
; Assemble with c64/build.js; build/gen.inc holds the generated tables and constants.

.include "gen.inc"

SQ1LO    = $c000            ; quarter-square tables, built at start-up (512 entries each)
SQ1HI    = $c200
SQ2LO    = $c400
SQ2HI    = $c600

SCREEN_A = $0400
SCREEN_B = $3400
D018_A   = $1e              ; screen $0400, APEXSCII at $3800
D018_B   = $de              ; screen $3400, APEXSCII at $3800
D018_ROM_A = $14            ; the same screens with the ROM font ($1000 for the VIC)
D018_ROM_B = $d4

.segment "ZEROPAGE"
px:      .res 2             ; player position, 8.8 tiles
py:      .res 2
pa:      .res 2             ; player angle, 0-1023 (0 east, 256 south)
oldp:    .res 6             ; px, py, pa as last drawn
ra:      .res 2             ; this ray's angle
secx:    .res 2             ; 1/|cos ra|, 1/|sin ra|, 8.8
secy:    .res 2
sidex:   .res 2             ; distance along the ray to the next x / y grid line
sidey:   .res 2
dist:    .res 2             ; distance to the wall that was hit
mptr:    .res 2             ; the start of the map row the ray is in
side:    .res 1             ; 0 = hit an east/west face, 1 = north/south
ray:     .res 1
lastq:   .res 1             ; the quadrant quad_setup last set up for
xmode:   .res 1             ; 0: multiply; 1: a whole secx / secy; 2: zero
ymode:   .res 1
m_a:     .res 1             ; multiply: m_r = m_a * m_b
m_b:     .res 2
m_r:     .res 3
t0:      .res 1
t1:      .res 1
t2:      .res 1
satx:    .res 1             ; a side distance has saturated at $FFFF
saty:    .res 1
savedx:  .res 2             ; the distance before the last step, once saturated
savedy:  .res 2
front:   .res 1             ; 0 = screen A showing, 1 = screen B
ticks:   .res 1             ; counts frames (the top-of-frame IRQ)
flipt:   .res 1             ; ticks when the last flip was asked for
shbuf:   .res 1             ; whose sprite registers the IRQ loads: 0 = screen A, 1 = B
last:    .res 1
nt:      .res 1
d018top: .res 1             ; $D018 above and below the split, for the screen showing
d018rom: .res 1
inp:     .res 1             ; 1 forward, 2 back, 4 left, 8 right
dx:      .res 1
dy:      .res 1
nx:      .res 2
ny:      .res 2
tp:      .res 2
tc:      .res 1
tr:      .res 1
xl:      .res 1
xh:      .res 1
yl:      .res 1
yh:      .res 1
sidx:    .res 1             ; SCRIPT builds only
scount:  .res 1
frames:  .res 1             ; BENCH builds only
ticks0:  .res 1
ticks_used: .res 1

.segment "BSS"
HE:      .res 40            ; per screen column: even ray's j (half height / 2) + 40, or + 168 for shade B
HO:      .res 40            ; and the odd ray's
HITL:    .res RAYS          ; per ray: the address of the tile it hit
HITH:    .res RAYS          ; (high byte, plus bit 7 for a north/south face)

.segment "LOADADDR"
    .word $0801

.segment "EXEHDR"           ; 10 SYS2061
    .word @next, 10
    .byte $9e, "2061", 0
@next:
    .word 0

.segment "CODE"
start:
    sei
    lda #COL_BORDER
    sta $d020
    lda #COL_BG             ; ceiling
    sta $d021
    lda #COL_MC1            ; floor
    sta $d022
    lda #COL_MC2            ; wall shade A
    sta $d023
    lda #$d0                ; multicolor on, 38 columns (the border hides the gradient's timing)
    sta $d016
    lda #$80                ; lock the shift+C= charset switch
    sta $0291
    lda #0
    sta front
    sta ticks
    sta last

    ; Colour RAM: the view is wall shade B in multicolor; the panel has its own colours.
    lda #8 | COL_WALLB
    ldx #0
:   sta $d800,x
    sta $d900,x
    sta $da00,x
    inx
    bne :-
    ldx #31
:   sta $db00,x
    dex
    bpl :-
    ldx #200
:   lda PANEL-1,x
    sta SCREEN_A + VIEW_ROWS*40 - 1,x
    sta SCREEN_B + VIEW_ROWS*40 - 1,x
    lda PANELC-1,x
    sta $d800 + VIEW_ROWS*40 - 1,x
    dex
    bne :-

.ifdef TEST
    lda #<TEST_X
    sta px
    lda #>TEST_X
    sta px+1
    lda #<TEST_Y
    sta py
    lda #>TEST_Y
    sta py+1
    lda #<TEST_A
    sta pa
    lda #>TEST_A
    sta pa+1
.else
    lda #<START_X
    sta px
    lda #>START_X
    sta px+1
    lda #<START_Y
    sta py
    lda #>START_Y
    sta py+1
    lda #<START_A
    sta pa
    lda #>START_A
    sta pa+1
.endif

    jsr init_squares
    lda #$ff                ; sprites: all multicolor, in front, shared colours
    sta $d01c
    lda #0
    sta $d01b
    sta $d015
    sta shbuf
    lda #SPR_MC1
    sta $d025
    lda #SPR_MC2
    sta $d026
.ifdef SCRIPT
    lda #0
    sta sidx
    sta scount
.endif

    ; The first frame goes straight into screen A, then the split starts.
    jsr moved
    jsr cast
    jsr project
    lda #0
    sta buf
    jsr draw_a
    jsr cut_all
    jsr status_a
    lda #D018_A
    sta d018top
    sta $d018
    lda #$ff
    sta flipt
    lda #D018_ROM_A
    sta d018rom

    lda #$7f                ; CIA timer IRQs off: only the raster IRQ runs
    sta $dc0d
    lda $dc0d
    lda #1
    sta $d01a
    lda $d011
    and #$7f
    sta $d011
    lda #SPLIT_LINE - 2
    sta $d012
    lda #<irq_split
    sta $0314
    lda #>irq_split
    sta $0315
    cli
.ifdef BENCH
    lda ticks
    sta ticks0
    sta last
.endif

.ifdef TEST
park:
    jmp park
.else
main:
    jsr control
    jsr moved               ; standing still: the screen showing is already right
    beq main
    jsr cast
    jsr project
    lda flipt               ; the last flip must be showing before drawing over the other screen
:   cmp ticks
    beq :-
    lda front
    bne @into_a
    lda #1
    sta buf
    jsr draw_b
    jsr cut_all
    jsr status_b
    lda #D018_B
    ldx #D018_ROM_B
    ldy #1
    bne @flip
@into_a:
    lda #0
    sta buf
    jsr draw_a
    jsr cut_all
    jsr status_a
    lda #D018_A
    ldx #D018_ROM_A
    ldy #0
@flip:
    sei                     ; the screen and its sprites switch together
    sty front
    sty shbuf
    stx d018rom
    sta d018top
    cli
    lda ticks               ; the top-of-frame IRQ after this one shows it
    sta flipt
.ifdef BENCH
    inc frames              ; after BENCH frames, park with the tick count in ticks_used
    lda frames
    cmp #BENCH
    bne main
    lda ticks
    sec
    sbc ticks0
    sta ticks_used
bench_done:
    jmp bench_done
.endif
    jmp main
.endif

; ------------------------------------------------------------------ raster IRQ
; Two lines above the split: spin to its first line, then switch to the ROM font.
irq_split:
    lda #COL_BG             ; the panel's background (the floor never shows $D021)
    sta $d021
    lda #SPLIT_LINE
    ldx d018rom
:   cmp $d012
    bne :-
    stx $d018
    lda #0
    sta $d012
    lda #<irq_top
    sta $0314
    lda #>irq_top
    sta $0315
    lda #$ff
    sta $d019
    jmp $ea81

; Top of the frame: APEXSCII and the screen to show, and the KERNAL's keyboard scan.
irq_top:
    lda d018top
    sta $d018
    lda shbuf               ; that screen's sprites
    asl
    asl
    asl
    tax
.repeat 8, I
    lda SHX+I,x
    sta $d000 + 2 * I
    lda SHY+I,x
    sta $d001 + 2 * I
    lda SHC+I,x
    sta $d027 + I
.endrepeat
    ldx shbuf
    lda SHMSB,x
    sta $d010
    lda SHEXP,x
    sta $d017
    sta $d01d
    lda SHEN,x
    sta $d015
    lda #GRAD_CEIL0         ; the gradient's first colours, then its raster IRQs (grad.inc)
    sta $d021
    lda #GRAD_FLOOR0
    sta $d022
    inc ticks
    lda #GRAD_TRIGGER
    sta $d012
    lda #<irq_grad0
    sta $0314
    lda #>irq_grad0
    sta $0315
    lda #$ff
    sta $d019
    jmp $ea31

; The ceiling and floor gradient: one IRQ per group of colour changes, generated by c64/gen.js.
.include "grad.inc"

; ------------------------------------------------------------------ raycaster
; For every ray: the DDA walk to the first wall, the fisheye-corrected distance, and the half wall
; height as j = halfH / 2: the largest j with perp <= TE[j], looked up in JT and refined.
;
; During the walk, Y is the map column and mptr the start of the map row, so a step in x is one
; INY or DEY (patched in per ray), and a step in y adds +-32 to mptr (also patched in).
cast:
    lda #$ff                ; set up the first ray's quadrant afresh
    sta lastq
    ldx #0                  ; the even rays, then the last
:   jsr cast_ray
    inx
    inx
    cpx #RAYS
    bcc :-
    ldx #RAYS - 1
    jsr cast_ray
    ldx #1                  ; then each odd ray: the mean of its neighbours when they hit the same face
@odd:
    lda HITL-1,x
    cmp HITL+1,x
    bne @full
    lda HITH-1,x
    cmp HITH+1,x
    bne @full
    txa                     ; j, stored as j + 40 or j + 168: (left + right) >> 1, carry into bit 7
    lsr
    tay
    lda HE,y
    clc
    adc HE+1,y
    ror
    sta HO,y
    clc                     ; and the distance, for the sprites
    lda PERPLO-1,x
    adc PERPLO+1,x
    sta t0
    lda PERPHI-1,x
    adc PERPHI+1,x
    ror
    sta PERPHI,x
    lda t0
    ror
    sta PERPLO,x
    jmp @next
@full:
    jsr cast_ray
@next:
    inx
    inx
    cpx #RAYS - 1
    bcc @odd
    rts

; Ray X: walk to the first wall, then store its distance, j and the face it hit. Returns X = the ray.
cast_ray:
    stx ray
    clc                     ; ra = (pa + COLANG[ray]) & 1023
    lda pa
    adc COLANG_LO,x
    sta ra
    lda pa+1
    adc COLANG_HI,x
    and #3
    cmp lastq               ; a new quadrant: patch the walk, the tables and the multiplies
    beq :+
    jsr quad_setup
:   ldy ra                  ; 1/|cos| and 1/|sin| from the tables quad_setup chose
p_sx0:
    lda SEC0LO,y
    sta secx
p_sx1:
    lda SEC0HI,y
    sta secx+1
p_sy0:
    lda SEC1LO,y
    sta secy
p_sy1:
    lda SEC1HI,y
    sta secy+1

    ; sidex = f * secx >> 8, where f is the distance to the next x line (set up by quad_setup)
    lda xmode
    bne cr_xspecial
    ldx secx
    sec
p_mx1:
    lda SQ1LO,x
p_mx2:
    sbc SQ2LO,x
p_mx3:
    lda SQ1HI,x
p_mx4:
    sbc SQ2HI,x
    sta t1
    ldx secx+1
    sec
p_mx5:
    lda SQ1LO,x
p_mx6:
    sbc SQ2LO,x
    sta t2
p_mx7:
    lda SQ1HI,x
p_mx8:
    sbc SQ2HI,x
    sta sidex+1
    lda t1
    clc
    adc t2
    sta sidex
    bcc cr_xdone
    inc sidex+1
    bcs cr_xdone
cr_xspecial:
    lsr                     ; 1: on the line, stepping east: a whole secx; 2: stepping west: 0
    bcc :+
    lda secx
    sta sidex
    lda secx+1
    sta sidex+1
    jmp cr_xdone
:   lda #0
    sta sidex
    sta sidex+1
cr_xdone:

    lda ymode               ; sidey the same way
    bne cr_yspecial
    ldx secy
    sec
p_my1:
    lda SQ1LO,x
p_my2:
    sbc SQ2LO,x
p_my3:
    lda SQ1HI,x
p_my4:
    sbc SQ2HI,x
    sta t1
    ldx secy+1
    sec
p_my5:
    lda SQ1LO,x
p_my6:
    sbc SQ2LO,x
    sta t2
p_my7:
    lda SQ1HI,x
p_my8:
    sbc SQ2HI,x
    sta sidey+1
    lda t1
    clc
    adc t2
    sta sidey
    bcc cr_ydone
    inc sidey+1
    bcs cr_ydone
cr_yspecial:
    lsr
    bcc :+
    lda secy
    sta sidey
    lda secy+1
    sta sidey+1
    jmp cr_ydone
:   lda #0
    sta sidey
    sta sidey+1
cr_ydone:

    lda #0
    sta satx
    sta saty
    ldx py+1                ; the row and column the player is in
    lda ROWLO,x
    sta mptr
    lda ROWHI,x
    sta mptr+1
    ldy px+1

    ; The walk. A saturated side distance (a sum past $FFFF) stays at $FFFF; the distance before the
    ; last step is then kept in savedx / savedy, since sidex - secx no longer gives it.
cr_step:
    lda sidex               ; sidex < sidey: step in x, otherwise in y
    cmp sidey
    lda sidex+1
    sbc sidey+1
    bcs cr_stepy
    lda sidex
    adc secx                ; carry is clear
    sta sidex
    lda sidex+1
    adc secx+1
    sta sidex+1
    bcs cr_satx
cr_xop:
p_xop:
    iny                     ; patched: INY or DEY
    lda (mptr),y
    beq cr_step
    lda satx
    bne cr_xsat
    sec                     ; dist = sidex - secx
    lda sidex
    sbc secx
    sta dist
    lda sidex+1
    sbc secx+1
    sta dist+1
    lda #0
    beq cr_hit
cr_xsat:
    lda savedx
    sta dist
    lda savedx+1
    sta dist+1
    lda #0
    beq cr_hit
cr_satx:
    sec                     ; the distance before this step, then saturate
    lda sidex
    sbc secx
    sta savedx
    lda sidex+1
    sbc secx+1
    sta savedx+1
    lda #$ff
    sta sidex
    sta sidex+1
    sta satx
    clc
    bcc cr_xop

cr_stepy:
    clc
    lda sidey
    adc secy
    sta sidey
    lda sidey+1
    adc secy+1
    sta sidey+1
    bcs cr_saty
cr_ystep:
    clc                     ; mptr += 32 or -32: the low byte, then the page only when it changes
    lda mptr
cr_yadd:
p_yadd:
    adc #32                 ; patched: 32 or $E0
    sta mptr
cr_ybr:
p_ybr:
    bcc cr_ylook              ; patched: BCC (south) or BCS (north)
cr_yop:
p_yop:
    inc mptr+1              ; patched: INC or DEC
cr_ylook:
    lda (mptr),y
    bne :+
    jmp cr_step
:   lda saty
    bne cr_ysat
    sec                     ; dist = sidey - secy
    lda sidey
    sbc secy
    sta dist
    lda sidey+1
    sbc secy+1
    sta dist+1
    lda #1
    bne cr_hit
cr_ysat:
    lda savedy
    sta dist
    lda savedy+1
    sta dist+1
    lda #1
    bne cr_hit
cr_saty:
    sec
    lda sidey
    sbc secy
    sta savedy
    lda sidey+1
    sbc secy+1
    sta savedy+1
    lda #$ff
    sta sidey
    sta sidey+1
    sta saty
    bne cr_ystep

cr_hit:
    sta side
    ldx ray                 ; the face it hit: the tile's address, plus bit 7 for a north/south face
    tya
    clc
    adc mptr
    sta HITL,x
    lda mptr+1
    adc #0
    ldy side
    beq :+
    ora #$80
:   sta HITH,x

    lda COLCOS,x            ; perp = dist * COLCOS[ray] >> 8, by quarter squares
    sta p_mf1+1
    sta p_mf3+1
    sta p_mf5+1
    sta p_mf7+1
    eor #$ff
    sta p_mf2+1
    sta p_mf4+1
    sta p_mf6+1
    sta p_mf8+1
    ldx dist
    sec
p_mf1:
    lda SQ1LO,x
p_mf2:
    sbc SQ2LO,x
p_mf3:
    lda SQ1HI,x
p_mf4:
    sbc SQ2HI,x
    sta t1
    ldx dist+1
    sec
p_mf5:
    lda SQ1LO,x
p_mf6:
    sbc SQ2LO,x
    sta t2
p_mf7:
    lda SQ1HI,x
p_mf8:
    sbc SQ2HI,x
    sta m_r+2
    lda t1
    clc
    adc t2
    sta m_r+1
    bcc :+
    inc m_r+2
:   ldx ray                 ; kept for the sprites' wall test
    lda m_r+1
    sta PERPLO,x
    lda m_r+2
    sta PERPHI,x

    ; j: JT gives the largest j for the start of perp's 32-wide bucket; step down while perp > TE[j].
    lda m_r+2
    cmp #64
    bcc :+
    lda #0                  ; perp >= 16384: no wall height at all
    jmp cr_found
:   lda m_r+1
    lsr
    lsr
    lsr
    lsr
    lsr
    sta t0
    lda m_r+2
    asl
    asl
    asl
    ora t0
    tax
    lda m_r+2
    and #32
    bne :+
    ldy JT0,x
    jmp cr_refine
:   ldy JT1,x
cr_refine:
    lda TE_LO,y             ; TE[j] >= perp?
    cmp m_r+1
    lda TE_HI,y
    sbc m_r+2
    bcs :+
    dey
    bne cr_refine
:   tya
cr_found:
    ldy side
    bne :+
    clc
    adc #168 - 40           ; east/west faces: shade B
:   clc
    adc #40
    tax
    lda ray
    lsr
    tay
    txa
    bcs cr_odd
    sta HE,y
    bcc cr_stored
cr_odd:
    sta HO,y
cr_stored:
    ldx ray
    rts

; A = the ray's quadrant, new since the last ray: patch the walk's steps, pick the 1/cos tables, and
; set up the side-distance multiplies, whose factor (the distance from the player to the next grid
; line in each direction) stays the same for the whole frame.
quad_setup:
    sta lastq
    tax
    lda XSTEP_OP,x
    sta p_xop
    lda YSTEP_LO,x
    sta p_yadd+1
    lda YSTEP_BR,x
    sta p_ybr
    lda YSTEP_OP,x
    sta p_yop
    txa                     ; even quadrants: secx from SEC0, secy from SEC1; odd: the other way round
    lsr
    lda #>SEC0LO
    ldy #>SEC1LO
    bcc :+
    lda #>SEC1LO
    ldy #>SEC0LO
:   sta p_sx0+2
    sty p_sy0+2
    clc
    adc #1                  ; each HI table is the page after its LO table
    sta p_sx1+2
    tya
    adc #1
    sta p_sy1+2

    lda XSTEP_OP,x          ; x: 256 - fx stepping east, fx stepping west; 0 and 256 done directly
    cmp #$c8
    bne @west
    lda px
    bne :+
    lda #1
    bne @xm
:   eor #$ff
    clc
    adc #1
    bne @xf
@west:
    lda px
    bne @xf
    lda #2
    bne @xm
@xf:
    sta p_mx1+1
    sta p_mx3+1
    sta p_mx5+1
    sta p_mx7+1
    eor #$ff
    sta p_mx2+1
    sta p_mx4+1
    sta p_mx6+1
    sta p_mx8+1
    lda #0
@xm:
    sta xmode

    lda YSTEP_LO,x          ; y the same way: 256 - fy stepping south, fy stepping north
    cmp #32
    bne @north
    lda py
    bne :+
    lda #1
    bne @ym
:   eor #$ff
    clc
    adc #1
    bne @yf
@north:
    lda py
    bne @yf
    lda #2
    bne @ym
@yf:
    sta p_my1+1
    sta p_my3+1
    sta p_my5+1
    sta p_my7+1
    eor #$ff
    sta p_my2+1
    sta p_my4+1
    sta p_my6+1
    sta p_my8+1
    lda #0
@ym:
    sta ymode
    rts

; m_r (24 bits) = A * m_b (16 bits), by quarter squares: a * b = f(a + b) - f(|a - b|), f(n) = n*n/4.
; The tables (SQ1 = f(n), SQ2 = f(|n - 255|)) are built by init_squares; clobbers X.
mul8x16:
    sta sm1+1
    sta sm3+1
    sta sm5+1
    sta sm7+1
    eor #$ff
    sta sm2+1
    sta sm4+1
    sta sm6+1
    sta sm8+1
    ldx m_b
    sec
sm1: lda SQ1LO,x
sm2: sbc SQ2LO,x
    sta m_r
sm3: lda SQ1HI,x
sm4: sbc SQ2HI,x
    sta t1
    ldx m_b+1
    sec
sm5: lda SQ1LO,x
sm6: sbc SQ2LO,x
    sta t2
sm7: lda SQ1HI,x
sm8: sbc SQ2HI,x
    sta m_r+2
    clc
    lda t1
    adc t2
    sta m_r+1
    bcc :+
    inc m_r+2
:   rts

; SQ1[n] = n*n/4 for n = 0..511 (adding ceil(n/2) each time), SQ2[n] = SQ1[|n - 255|].
init_squares:
    lda #0
    sta t1
    sta t2
    tay
    tax
@sq:
    lda t1
    cpx #0
    bne @hi
    sta SQ1LO,y
    lda t2
    sta SQ1HI,y
    jmp @next
@hi:
    sta SQ1LO+256,y
    lda t2
    sta SQ1HI+256,y
@next:
    tya                     ; add (n + 1) >> 1
    clc
    adc #1
    sta t0
    txa
    adc #0
    lsr
    lda t0
    ror
    clc
    adc t1
    sta t1
    bcc :+
    inc t2
:   iny
    bne @sq
    inx
    cpx #2
    bne @sq
    ldy #0
@sq2:
    tya
    eor #$ff
    tax
    lda SQ1LO,x
    sta SQ2LO,y
    lda SQ1HI,x
    sta SQ2HI,y
    lda SQ1LO+1,y
    sta SQ2LO+256,y
    lda SQ1HI+1,y
    sta SQ2HI+256,y
    iny
    bne @sq2
    rts

; ------------------------------------------------------------------ drawing
; Row r above the horizon shows the "ray top" glyph $40 + 9 * left state + right state, row r below
; it the "ray bottom" glyph 81 codes later. A ray's state in row r is CL / CL9 at its stored height
; minus 4r, which is the same as indexing a table based 4r bytes lower.
.macro DRAWROW scr, r
    .local loop
    ldy #39
loop:
    ldx HE,y
    lda CL9 - 4 * r,x
    ldx HO,y
    clc
    adc CL - 4 * r,x
    sta scr + (HALF_ROWS - 1 - r) * 40,y
    adc #81
    sta scr + (HALF_ROWS + r) * 40,y
    dey
    bpl loop
.endmacro

draw_a:
.repeat HALF_ROWS, R
    DRAWROW SCREEN_A, R
.endrepeat
    rts

draw_b:
.repeat HALF_ROWS, R
    DRAWROW SCREEN_B, R
.endrepeat
    rts

; The position and heading in the status panel, as the reference formats them.
.macro STATUS scr
    ldx px
    lda TENTHD,x
    sta scr + STATUS_ROW * 40 + POS_X + 3
    lda px+1
    clc
    adc TENTHC,x
    tax
    lda DEC0,x
    sta scr + STATUS_ROW * 40 + POS_X
    lda DEC1,x
    sta scr + STATUS_ROW * 40 + POS_X + 1
    ldx py
    lda TENTHD,x
    sta scr + STATUS_ROW * 40 + POS_Y + 3
    lda py+1
    clc
    adc TENTHC,x
    tax
    lda DEC0,x
    sta scr + STATUS_ROW * 40 + POS_Y
    lda DEC1,x
    sta scr + STATUS_ROW * 40 + POS_Y + 1
    jsr heading
    lda HEAD0,x
    sta scr + STATUS_ROW * 40 + POS_H
    lda HEAD1,x
    sta scr + STATUS_ROW * 40 + POS_H + 1
    lda HEAD2,x
    sta scr + STATUS_ROW * 40 + POS_H + 2
.endmacro

status_a:
    STATUS SCREEN_A
    rts
status_b:
    STATUS SCREEN_B
    rts

; Z clear if px, py or pa changed since the last call, which keeps them in oldp.
moved:
    ldy #0
    ldx #5
@b: lda px,x
    cmp oldp,x
    beq :+
    sta oldp,x
    iny
:   dex
    bpl @b
    cpy #0
    rts

; X = pa >> 2, the heading index for HEAD and MOVX / MOVY.
heading:
    lda pa+1
    sta t0
    lda pa
    lsr t0
    ror
    lsr t0
    ror
    tax
    rts

; ------------------------------------------------------------------ movement
.ifndef TEST
; Runs the controls once per frame that has passed since the last call (up to 8).
.ifdef BENCH
control:                    ; benchmark: one tick per frame, so every build draws the same 64 frames
    lda #1
    sta nt
    bne @tick
.else
control:
    lda ticks
    sec
    sbc last
    bne :+
    rts
.endif
:   cmp #9
    bcc :+
    lda #8
:   sta nt
    lda ticks
    sta last
@tick:
    jsr input
    lda inp
    and #4
    beq :+
    sec                     ; turn left
    lda pa
    sbc #4
    sta pa
    lda pa+1
    sbc #0
    and #3
    sta pa+1
:   lda inp
    and #8
    beq :+
    clc                     ; turn right
    lda pa
    adc #4
    sta pa
    lda pa+1
    adc #0
    and #3
    sta pa+1
:   lda inp
    and #3
    beq @next
    jsr heading
    lda MOVX,x
    sta dx
    lda MOVY,x
    sta dy
    lda inp
    and #2
    beq :+
    lda #0                  ; backwards
    sec
    sbc dx
    sta dx
    lda #0
    sec
    sbc dy
    sta dy
:   jsr walk
@next:
    dec nt
    bne @tick
    rts

; inp from joystick port 2 and the W/A/S/D keys (the KERNAL's last key pressed, $CB).
input:
.ifdef BENCH
    lda #8                  ; benchmark: keep turning right
    sta inp
    rts
.endif
.ifdef SCRIPT
    ldx sidx                ; scripted test: SCRIPT_IN[i] for SCRIPT_N[i] ticks, then nothing
    lda SCRIPT_N,x
    bne :+
    lda #0
    sta inp
    rts
:   lda SCRIPT_IN,x
    sta inp
    inc scount
    lda scount
    cmp SCRIPT_N,x
    bne :+
    inc sidx
    lda #0
    sta scount
:   rts
.endif
    lda $dc00
    eor #$ff
    and #$0f
    sta inp
    lda $cb
    ldx #3
:   cmp KEYS,x
    beq @key
    dex
    bpl :-
    rts
@key:
    lda inp
    ora KEYBITS,x
    sta inp
    rts

; Move by (dx, dy), each axis separately so the player slides along walls.
walk:
    ldx #0
    lda dx
    bpl :+
    dex
:   clc
    adc px
    sta nx
    txa
    adc px+1
    sta nx+1
    lda py
    sta ny
    lda py+1
    sta ny+1
    jsr clear
    bcs :+
    lda nx
    sta px
    lda nx+1
    sta px+1
:   lda px
    sta nx
    lda px+1
    sta nx+1
    ldx #0
    lda dy
    bpl :+
    dex
:   clc
    adc py
    sta ny
    txa
    adc py+1
    sta ny+1
    jsr clear
    bcs :+
    lda ny
    sta py
    lda ny+1
    sta py+1
:   rts

; Carry clear if a quarter-tile square around (nx, ny) is all open floor.
clear:
    sec
    lda nx
    sbc #64
    lda nx+1
    sbc #0
    sta xl
    clc
    lda nx
    adc #64
    lda nx+1
    adc #0
    sta xh
    sec
    lda ny
    sbc #64
    lda ny+1
    sbc #0
    sta yl
    clc
    lda ny
    adc #64
    lda ny+1
    adc #0
    sta yh
    lda yl
    sta tr
    lda xl
    sta tc
    jsr tile
    bne @no
    lda xh
    sta tc
    jsr tile
    bne @no
    lda yh
    sta tr
    jsr tile
    bne @no
    lda xl
    sta tc
    jsr tile
    bne @no
    clc
    rts
@no:
    sec
    rts

; A = the tile at column tc, row tr.
tile:
    ldy tr
    lda ROWLO,y
    sta tp
    lda ROWHI,y
    sta tp+1
    ldy tc
    lda (tp),y
    rts
.endif

.include "sprites.s"

.segment "RODATA"
XSTEP_OP: .byte $c8, $88, $88, $c8 ; per quadrant of the ray angle: INY (east) or DEY (west)
YSTEP_LO: .byte 32, 32, $e0, $e0   ; +32 (south) or -32 (north) on the map row pointer
YSTEP_BR: .byte $90, $90, $b0, $b0 ; BCC / BCS: skip the page change
YSTEP_OP: .byte $e6, $e6, $c6, $c6 ; INC / DEC zp
KEYS:    .byte $09, $0d, $0a, $12 ; W S A D
KEYBITS: .byte 1, 2, 4, 8
ROWLO:
.repeat 64, I
    .byte <(LEVEL + I * 32)
.endrepeat
ROWHI:
.repeat 64, I
    .byte >(LEVEL + I * 32)
.endrepeat

.segment "CHARSET"
    .incbin "charset.bin"
