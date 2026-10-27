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
ra:      .res 2             ; this ray's angle
secx:    .res 2             ; 1/|cos ra|, 1/|sin ra|, 8.8
secy:    .res 2
sidex:   .res 2             ; distance along the ray to the next x / y grid line
sidey:   .res 2
dist:    .res 2             ; distance to the wall that was hit
mptr:    .res 2             ; the start of the map row the ray is in
sp:      .res 2             ; pointer into the SEC tables (low byte always 0)
side:    .res 1             ; 0 = hit an east/west face, 1 = north/south
ray:     .res 1
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
    lda #$d8                ; multicolor on
    sta $d016
    lda #$80                ; lock the shift+C= charset switch
    sta $0291
    lda #0
    sta sp
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
.ifdef SCRIPT
    lda #0
    sta sidx
    sta scount
.endif

    ; The first frame goes straight into screen A, then the split starts.
    jsr cast
    jsr draw_a
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
    jsr cast
    lda flipt               ; the last flip must be showing before drawing over the other screen
:   cmp ticks
    beq :-
    lda front
    bne @into_a
    jsr draw_b
    jsr status_b
    lda #D018_B
    ldx #D018_ROM_B
    ldy #1
    bne @flip
@into_a:
    jsr draw_a
    jsr status_a
    lda #D018_A
    ldx #D018_ROM_A
    ldy #0
@flip:
    sty front
    stx d018rom
    sta d018top
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
    inc ticks
    lda #SPLIT_LINE - 2
    sta $d012
    lda #<irq_split
    sta $0314
    lda #>irq_split
    sta $0315
    lda #$ff
    sta $d019
    jmp $ea31

; ------------------------------------------------------------------ raycaster
; For every ray: the DDA walk to the first wall, the fisheye-corrected distance, and the half wall
; height as j = halfH / 2: the largest j with perp <= TE[j], looked up in JT and refined.
;
; During the walk, Y is the map column and mptr the start of the map row, so a step in x is one
; INY or DEY (patched in per ray), and a step in y adds +-32 to mptr (also patched in).
cast:
    ldx #0
@ray:
    stx ray
    clc                     ; ra = (pa + COLANG[ray]) & 1023
    lda pa
    adc COLANG_LO,x
    sta ra
    lda pa+1
    adc COLANG_HI,x
    and #3
    sta ra+1
    ldy ra                  ; secx = SECA[ra]
    clc
    adc #>SECLO
    sta sp+1
    lda (sp),y
    sta secx
    lda sp+1
    clc
    adc #4                  ; SECHI follows SECLO
    sta sp+1
    lda (sp),y
    sta secx+1
    lda ra+1                ; secy = SECA[(ra + 768) & 1023]
    clc
    adc #3
    and #3
    clc
    adc #>SECLO
    sta sp+1
    lda (sp),y
    sta secy
    lda sp+1
    clc
    adc #4
    sta sp+1
    lda (sp),y
    sta secy+1

    ldx ra+1                ; patch the steps for this quadrant
    lda XSTEP_OP,x
    sta @xop
    lda YSTEP_LO,x
    sta @yadd+1
    lda YSTEP_BR,x
    sta @ybr
    lda YSTEP_OP,x
    sta @yop

    ; sidex = (distance to the next x line) * secx >> 8, with 256 and 0 done directly
    lda XSTEP_OP,x
    cmp #$c8                ; INY: stepping east
    bne @xneg
    lda px
    beq @x256
    eor #$ff                ; 256 - fx
    clc
    adc #1
    bne @xmul
@xneg:
    lda px
    beq @x0
@xmul:
    ldy secx
    sty m_b
    ldy secx+1
    sty m_b+1
    jsr mul8x16
    lda m_r+1
    sta sidex
    lda m_r+2
    sta sidex+1
    jmp @xdone
@x256:
    lda secx
    sta sidex
    lda secx+1
    sta sidex+1
    jmp @xdone
@x0:
    lda #0
    sta sidex
    sta sidex+1
@xdone:
    ldx ra+1
    lda YSTEP_LO,x
    cmp #32                 ; stepping south
    bne @yneg
    lda py
    beq @y256
    eor #$ff
    clc
    adc #1
    bne @ymul
@yneg:
    lda py
    beq @y0
@ymul:
    ldy secy
    sty m_b
    ldy secy+1
    sty m_b+1
    jsr mul8x16
    lda m_r+1
    sta sidey
    lda m_r+2
    sta sidey+1
    jmp @ydone
@y256:
    lda secy
    sta sidey
    lda secy+1
    sta sidey+1
    jmp @ydone
@y0:
    lda #0
    sta sidey
    sta sidey+1
@ydone:

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
@step:
    lda sidex               ; sidex < sidey: step in x, otherwise in y
    cmp sidey
    lda sidex+1
    sbc sidey+1
    bcs @stepy
    lda sidex
    adc secx                ; carry is clear
    sta sidex
    lda sidex+1
    adc secx+1
    sta sidex+1
    bcs @satx
@xop:
    iny                     ; patched: INY or DEY
    lda (mptr),y
    beq @step
    lda satx
    bne @xsat
    sec                     ; dist = sidex - secx
    lda sidex
    sbc secx
    sta dist
    lda sidex+1
    sbc secx+1
    sta dist+1
    lda #0
    beq @hit
@xsat:
    lda savedx
    sta dist
    lda savedx+1
    sta dist+1
    lda #0
    beq @hit
@satx:
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
    bcc @xop

@stepy:
    clc
    lda sidey
    adc secy
    sta sidey
    lda sidey+1
    adc secy+1
    sta sidey+1
    bcs @saty
@ystep:
    clc                     ; mptr += 32 or -32: the low byte, then the page only when it changes
    lda mptr
@yadd:
    adc #32                 ; patched: 32 or $E0
    sta mptr
@ybr:
    bcc @ylook              ; patched: BCC (south) or BCS (north)
@yop:
    inc mptr+1              ; patched: INC or DEC
@ylook:
    lda (mptr),y
    bne :+
    jmp @step
:   lda saty
    bne @ysat
    sec                     ; dist = sidey - secy
    lda sidey
    sbc secy
    sta dist
    lda sidey+1
    sbc secy+1
    sta dist+1
    lda #1
    bne @hit
@ysat:
    lda savedy
    sta dist
    lda savedy+1
    sta dist+1
    lda #1
    bne @hit
@saty:
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
    bne @ystep

@hit:
    sta side
    ldx ray                 ; perp = dist * COLCOS[ray] >> 8, in m_r+1 / m_r+2
    lda dist
    sta m_b
    lda dist+1
    sta m_b+1
    lda COLCOS,x
    jsr mul8x16

    ; j: JT gives the largest j for the start of perp's 32-wide bucket; step down while perp > TE[j].
    lda m_r+2
    cmp #64
    bcc :+
    lda #0                  ; perp >= 16384: no wall height at all
    jmp @found
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
    jmp @refine
:   ldy JT1,x
@refine:
    lda TE_LO,y             ; TE[j] >= perp?
    cmp m_r+1
    lda TE_HI,y
    sbc m_r+2
    bcs :+
    dey
    bne @refine
:   tya
@found:
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
    bcs @odd
    sta HE,y
    bcc @stored
@odd:
    sta HO,y
@stored:
    ldx ray
    inx
    cpx #RAYS
    beq :+
    jmp @ray
:   rts

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
control:
    lda ticks
    sec
    sbc last
    bne :+
    rts
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
