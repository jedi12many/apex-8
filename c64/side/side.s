; APEX platformer for the Commodore 64: a side-scrolling level with parallax bands, at 50 frames a
; second. It follows the reference (core/platform.js, c64/side/view.js) step for step, so every frame
; is exactly the reference's frame.
;
; The screen is three bands of multicolor characters in 38 columns (see c64/side/view.js):
;   rows 0-4  mountains at 1/4 of the camera's speed     rows 5-8  hills at 1/2
;   rows 9-24 the level at full speed, its empty cells a forest at 3/4 (characters redrawn in place)
; Each band has its own fine scroll and colours, set by raster splits. The bands' characters are
; drawn into whichever of two screens isn't showing when a band's first column changes, and the
; screens swap at the bottom of the frame together with the scroll registers, the sprite and the
; forest's characters, so nothing tears.
;
; Each frame: read the controls, move the player one tick, move the camera, then work out the next
; frame and leave it for the bottom-of-frame IRQ to show.
;
; Controls: joystick in port 2 (fire or up to jump), or A / D to run and W, Z or Space to jump;
; R restarts. Assemble with c64/side/build.js.

.include "gen.inc"

SCREEN_A = $0400
SCREEN_B = $3000
SPRITES  = $3400
CHARSET  = $3800
D018_A   = $1e              ; screen $0400, characters $3800
D018_B   = $ce              ; screen $3000, characters $3800
SPRPTR   = SPRITES / 64

; ca65 can't take a negative immediate for a byte; these are the byte values.
NEG_JUMP     = <(-JUMP)
NEG_JUMP_CUT = <(-JUMP_CUT)
NEG_MAX_RUN  = <(-MAX_RUN)

; Waits exactly n cycles (n >= 2).
.macro delay n
  .if n & 1
    bit $ea
    .repeat (n - 3) / 2
      nop
    .endrepeat
  .else
    .repeat n / 2
      nop
    .endrepeat
  .endif
.endmacro

.segment "ZEROPAGE"
px:      .res 2             ; the player: x (12.4, pixels * 16), y (signed)
py:      .res 2
vx:      .res 1             ; velocities, 1/16 pixel a frame, signed
vy:      .res 1
ground:  .res 1             ; 1 when standing
coyote:  .res 1             ; frames a jump still works after leaving the ground
jbuf:    .res 1             ; frames a jump press waits for the ground
held:    .res 1             ; last frame's input
facing:  .res 1             ; 0 right, 1 left
frm:     .res 1             ; run cycle, 0-15
inp:     .res 1             ; 1 left, 2 right, 4 jump
cam:     .res 2             ; the camera's left edge, pixels
nx:      .res 2             ; a new position being tried
ny:      .res 2
hx:      .res 2             ; hits: the box's corner
hy:      .res 2
bxa:     .res 1             ; hits: the box's block columns and last block row
bxb:     .res 1
byb:     .res 1
sp:      .res 2             ; hits: the solid row
t0:      .res 1
t1:      .res 1
t2:      .res 1
sa:      .res 1             ; registers saved by the IRQs
sx:      .res 1
sy:      .res 1
cur:     .res 1             ; the screen the last frame worked out shows: 0 A, 1 B
xs0:     .res 1             ; $D016 for the mountains, the hills and the level, as showing
xs1:     .res 1
xs2:     .res 1
shift:   .res 1             ; the forest's shift as showing
ready:   .res 1             ; 1: the next frame is worked out (p_*)
applied: .res 1             ; 1: the bottom IRQ showed it
counting: .res 1            ; 1 while missed frames count
missed:  .res 2             ; frames that showed the same picture again because the next wasn't ready
maxcyc:  .res 2             ; the most cycles from the bottom of a frame to the next frame being ready
sptr:    .res 2             ; SCRIPT builds: the next (input, ticks) pair
scount:  .res 1
p_d018:  .res 1             ; the next frame
p_xs0:   .res 1
p_xs1:   .res 1
p_xs2:   .res 1
p_sx:    .res 1
p_msb:   .res 1
p_sy:    .res 1
p_en:    .res 1
p_ptr:   .res 1
p_shift: .res 1
c_far:   .res 1             ; the first column of each band in the next frame
c_hills: .res 1
c_level: .res 1

.segment "BSS"
crs_far:   .res 2           ; per screen: the first column each band is drawn from ($FF: not drawn)
crs_hills: .res 2
crs_level: .res 2

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
    lda #$35                ; RAM in place of BASIC and the KERNAL; I/O stays
    sta $01
    lda #$7f                ; no CIA interrupts
    sta $dc0d
    sta $dd0d
    lda $dc0d
    lda $dd0d
    lda #<nmi
    sta $fffa
    lda #>nmi
    sta $fffb
    lda #<irq_bottom
    sta $fffe
    lda #>irq_bottom
    sta $ffff
    lda #$0b                ; screen off while setting up
    sta $d011

    lda #COL_BORDER
    sta $d020
    lda #FAR_BG
    sta $d021
    lda #FAR_MC1
    sta $d022
    lda #FAR_MC2
    sta $d023
    ; colour RAM: one value per band
    ldx #0
    lda #LEVEL_RAM
:   sta $d800,x
    sta $d900,x
    sta $da00,x
    sta $db00,x
    inx
    bne :-
    ldx #200
    lda #FAR_RAM
:   sta $d800-1,x
    dex
    bne :-
    ldx #160
    lda #HILLS_RAM
:   sta $d800+200-1,x
    dex
    bne :-
    ; the player's sprite
    lda #1
    sta $d01c
    lda #0
    sta $d017
    sta $d01d
    sta $d01b
    lda #SPR_MC1
    sta $d025
    lda #SPR_MC2
    sta $d026
    lda #SPR_COLOR
    sta $d027
    ; CIA 1 timer A runs freely from each frame's bottom, timing the main loop
    lda #$ff
    sta $dc04
    sta $dc05

    lda #0
    sta counting
    sta missed
    sta missed+1
    sta maxcyc
    sta maxcyc+1
    sta scount
    sta cam
    sta cam+1
    lda #$ff
    sta shift
    ldx #1
:   sta crs_far,x
    sta crs_hills,x
    sta crs_level,x
    dex
    bpl :-
    lda #1                  ; the first frame goes to screen A
    sta cur
.ifdef SCRIPT
    lda #<SCRIPT_DATA
    sta sptr
    lda #>SCRIPT_DATA
    sta sptr+1
.endif
    jsr reset_player
    jsr follow
    jsr view
    jsr apply
    lda #0                  ; (the timer wasn't running for that one)
    sta maxcyc
    sta maxcyc+1

    lda #IRQ_BOTTOM + 2     ; start just after the bottom of a frame, so the first frame has a whole
:   cmp $d012               ; frame's time like every other
    bne :-
    lda #%00010001          ; and time it from there (the KERNAL left the timer on its own latch)
    sta $dc0e
    lda #IRQ_BOTTOM
    sta $d012
    lda #$1b                ; screen on, 25 rows, raster line bit 8 clear
    sta $d011
    lda #1
    sta $d01a
    sta $d019
    sta counting
    cli

main:
    lda applied             ; wait for the last frame to show
    beq main
    lda #0
    sta applied
    jsr input
    bcs script_done
    jsr tick
    jsr follow
    jsr view
    jmp main

; SCRIPT builds stop here when the script ends; the last frame stays on the screen.
script_done:
    lda #0
    sta counting
script_park:
    jmp script_park

nmi:
    rti

; ------------------------------------------------------------------ controls
; inp from the joystick in port 2 and the keyboard; C set when a SCRIPT build's script has ended.
input:
.ifdef SCRIPT
    ldy #1                  ; SCRIPT builds: input sptr[0] for sptr[1] ticks, pairs until a 0 count
    lda (sptr),y
    bne :+
    sec
    rts
:   dey
    lda (sptr),y
    sta inp
    inc scount
    lda scount
    iny
    cmp (sptr),y
    bne :+
    lda #0
    sta scount
    lda sptr
    clc
    adc #2
    sta sptr
    bcc :+
    inc sptr+1
:   clc
    rts
.else
    lda #0
    sta inp
    lda #$ff                ; no keyboard row: $DC00 reads the joystick
    sta $dc00
    lda $dc00
    eor #$ff
    sta t0
    and #4
    beq :+
    lda #1
    sta inp
:   lda t0
    and #8
    beq :+
    lda inp
    ora #2
    sta inp
:   lda t0
    and #$11                ; fire or up
    beq :+
    lda inp
    ora #4
    sta inp
:   lda #%11111101          ; keyboard row 1: W (bit 1), A (2), Z (4)
    sta $dc00
    lda $dc01
    eor #$ff
    sta t0
    and #4
    beq :+
    lda inp
    ora #1
    sta inp
:   lda t0
    and #$12
    beq :+
    lda inp
    ora #4
    sta inp
:   lda #%01111111          ; row 7: Space (bit 4)
    sta $dc00
    lda $dc01
    and #$10
    bne :+
    lda inp
    ora #4
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
    ora #2
    sta inp
:   lda t0
    and #2
    beq :+
    jsr reset_player        ; R: start again
    lda #0
    sta cam
    sta cam+1
    jsr follow
:   clc
    rts
.endif

; ------------------------------------------------------------------ the player (core/platform.js)
reset_player:
    lda #<START_X
    sta px
    lda #>START_X
    sta px+1
    lda #<START_Y
    sta py
    lda #>START_Y
    sta py+1
    lda #0
    sta vx
    sta vy
    sta coyote
    sta jbuf
    sta held
    sta facing
    sta frm
    lda #1
    sta ground
    rts

; One frame of movement: horizontal, then vertical, each stopped at the block it would enter.
tick:
    ldx #AIR_ACCEL
    lda ground
    beq :+
    ldx #ACCEL
:   stx t0
    lda inp
    and #3
    cmp #1
    bne @notleft
    lda vx                  ; left: vx = max(vx - acc, -MAX_RUN)
    sec
    sbc t0
    bpl :+
    cmp #NEG_MAX_RUN
    bcs :+
    lda #NEG_MAX_RUN
:   sta vx
    lda #1
    sta facing
    jmp @move
@notleft:
    cmp #2
    bne @neither
    lda vx                  ; right: vx = min(vx + acc, MAX_RUN)
    clc
    adc t0
    bmi :+
    cmp #MAX_RUN + 1
    bcc :+
    lda #MAX_RUN
:   sta vx
    lda #0
    sta facing
    jmp @move
@neither:
    lda ground              ; on the ground, friction slows to a stop
    beq @move
    lda vx
    beq @move
    bmi @slowl
    sec
    sbc #FRICTION
    bpl :+
    lda #0
:   sta vx
    jmp @move
@slowl:
    clc
    adc #FRICTION
    bmi :+
    lda #0
:   sta vx

@move:
    lda vx
    beq @vert
    ldx #0                  ; nx = x + vx
    lda vx
    bpl :+
    dex
:   clc
    adc px
    sta nx
    sta hx
    txa
    adc px+1
    sta nx+1
    sta hx+1
    lda py
    sta hy
    lda py+1
    sta hy+1
    jsr hits
    bcs @hhit
    lda nx
    sta px
    lda nx+1
    sta px+1
    jmp @vert
@hhit:
    lda vx
    bmi @hleft
    lda nx                  ; against a block on the right: x = its left edge - width
    clc
    adc #<192
    lda nx+1
    adc #0
    sec
    sbc #1
    sta px+1
    lda #64                 ; (- 192 = - 256 + 64)
    sta px
    jmp @hstop
@hleft:
    lda nx+1                ; on the left: x = its right edge
    clc
    adc #1
    sta px+1
    lda #0
    sta px
@hstop:
    lda #0
    sta vx

@vert:
    lda inp                 ; a new jump press waits BUFFER frames for the ground
    and #4
    beq @nopress
    lda held
    and #4
    bne @nopress
    lda #BUFFER
    sta jbuf
    bne @coy
@nopress:
    lda jbuf
    beq @coy
    dec jbuf
@coy:
    lda ground
    beq :+
    lda #COYOTE
    sta coyote
    bne @jump
:   lda coyote
    beq @jump
    dec coyote
@jump:
    lda jbuf
    beq @cut
    lda coyote
    beq @cut
    lda #NEG_JUMP
    sta vy
    lda #0
    sta jbuf
    sta coyote
@cut:
    lda inp                 ; jump let go while rising fast: slow to JUMP_CUT
    and #4
    bne @fall
    lda vy
    bpl @fall
    cmp #NEG_JUMP_CUT
    bcs @fall
    lda #NEG_JUMP_CUT
    sta vy
@fall:
    lda vy                  ; vy = min(vy + GRAVITY, MAX_FALL)
    clc
    adc #GRAVITY
    bmi :+
    cmp #MAX_FALL + 1
    bcc :+
    lda #MAX_FALL
:   sta vy
    ldx #0                  ; ny = y + vy
    lda vy
    bpl :+
    dex
:   clc
    adc py
    sta ny
    sta hy
    txa
    adc py+1
    sta ny+1
    sta hy+1
    lda px
    sta hx
    lda px+1
    sta hx+1
    lda #0
    sta ground
    jsr hits
    bcs @vhit
    lda ny
    sta py
    lda ny+1
    sta py+1
    jmp @after
@vhit:
    lda vy
    beq @head
    bmi @head
    lda ny                  ; landing: y = the block's top - height
    clc
    adc #<320
    lda ny+1
    adc #>320
    sec
    sbc #2
    sta py+1
    lda #192                ; (- 320 = - 512 + 192)
    sta py
    lda #0
    sta vy
    lda #1
    sta ground
    jmp @after
@head:
    lda ny+1                ; a block overhead: y = its bottom
    clc
    adc #1
    sta py+1
    lda #0
    sta py
    sta vy

@after:
    lda #<PIT               ; fell into a pit (y > PIT, signed): start again
    cmp py
    lda #>PIT
    sbc py+1
    bvc :+
    eor #$80
:   bpl :+
    jsr reset_player
:   lda inp
    sta held
    lda ground              ; the run cycle advances while running on the ground
    beq @done
    lda vx
    beq :+
    lda frm
    clc
    adc #1
    and #15
:   sta frm
@done:
    rts

; C set if any block under the box (hx, hy) .. + (12, 20) pixels is solid. Outside the level left and
; right is solid; above and below is not.
hits:
    lda hx+1
    sta bxa
    cmp #LEVEL_W            ; (a column below 0 is $FF)
    bcs @hit
    lda hx
    clc
    adc #191
    lda hx+1
    adc #0
    sta bxb
    cmp #LEVEL_W
    bcs @hit
    lda hy
    clc
    adc #<319
    lda hy+1
    adc #>319
    sta byb
    ldy hy+1
@row:
    cpy #LEVEL_H            ; rows above and below the level are empty
    bcs @next
    lda SOLIDLO,y
    sta sp
    lda SOLIDHI,y
    sta sp+1
    sty t2
    ldy bxa
    lda (sp),y
    bne @hit
    ldy bxb
    lda (sp),y
    bne @hit
    ldy t2
@next:
    cpy byb
    beq @clear
    iny
    jmp @row
@clear:
    clc
    rts
@hit:
    sec
    rts

; The camera follows the player within the dead zone, inside the level.
follow:
    lda px+1                ; t0/t1 = x in pixels
    sta t1
    lda px
    lsr t1
    ror
    lsr t1
    ror
    lsr t1
    ror
    lsr t1
    ror
    sta t0
    sec                     ; past the right of the dead zone: cam = px - DEAD1
    sbc cam
    tax
    lda t1
    sbc cam+1
    sta t2
    txa
    sec
    sbc #DEAD1 + 1
    lda t2
    sbc #0
    bmi :+
    lda t0
    sec
    sbc #DEAD1
    sta cam
    lda t1
    sbc #0
    sta cam+1
:   lda t0                  ; past its left: cam = px - DEAD0
    sec
    sbc cam
    tax
    lda t1
    sbc cam+1
    sta t2
    txa
    sec
    sbc #DEAD0
    lda t2
    sbc #0
    bpl :+
    lda t0
    sec
    sbc #DEAD0
    sta cam
    lda t1
    sbc #0
    sta cam+1
:   lda cam+1
    bpl :+
    lda #0
    sta cam
    sta cam+1
    rts
:   lda #<MAXCAM
    cmp cam
    lda #>MAXCAM
    sbc cam+1
    bcs :+
    lda #<MAXCAM
    sta cam
    lda #>MAXCAM
    sta cam+1
:   rts

; ------------------------------------------------------------------ the next frame
; A band's pixel offset in t0/t1 -> A = its $D016 (multicolor, 38 columns, fine scroll), t0 = its
; first column (the offset rounded up to a whole character; the fine scroll makes up the rest).
offs:
    lda t0
    eor #$ff
    clc
    adc #1
    and #7
    ora #$10
    pha
    lda t0
    clc
    adc #7
    sta t0
    bcc :+
    inc t1
:   lsr t1
    ror t0
    lsr t1
    ror t0
    lsr t1
    ror t0
    pla
    rts

; Works out the next frame: draws any band whose first column changed into the other screen, and
; leaves the registers for the bottom IRQ.
view:
    lda cam                 ; mountains: cam / 4
    sta t0
    lda cam+1
    sta t1
    lsr t1
    ror t0
    lsr t1
    ror t0
    jsr offs
    sta p_xs0
    lda t0
    and #FAR_W - 1
    sta c_far
    lda cam                 ; hills: cam / 2, columns mod HILLS_W
    sta t0
    lda cam+1
    sta t1
    lsr t1
    ror t0
    jsr offs
    sta p_xs1
    lda t0
:   cmp #HILLS_W
    bcc :+
    sbc #HILLS_W
    bcs :-
:   sta c_hills
    lda cam                 ; the level
    sta t0
    lda cam+1
    sta t1
    jsr offs
    sta p_xs2
    lda t0
    sta c_level

    ldx cur                 ; the screen showing has every band right: keep it
    lda c_far
    cmp crs_far,x
    bne @swap
    lda c_hills
    cmp crs_hills,x
    bne @swap
    lda c_level
    cmp crs_level,x
    beq @screen
@swap:
    txa                     ; otherwise bring the other screen up to date and show it
    eor #1
    sta cur
    tax
    lda c_far
    cmp crs_far,x
    beq @hills
    sta crs_far,x
    cpx #0
    bne :+
    jsr draw_far_a
    jmp @hills
:   jsr draw_far_b
@hills:
    ldx cur
    lda c_hills
    cmp crs_hills,x
    beq @level
    sta crs_hills,x
    cpx #0
    bne :+
    jsr draw_hills_a
    jmp @level
:   jsr draw_hills_b
@level:
    ldx cur
    lda c_level
    cmp crs_level,x
    beq @screen
    sta crs_level,x
    cpx #0
    bne :+
    jsr draw_level_a
    jmp @screen
:   jsr draw_level_b
@screen:
    ldx cur
    lda D018S,x
    sta p_d018

    ; the sprite: x = (x >> 4) - cam + SPR_X (9 bits)
    lda px+1
    sta t1
    lda px
    lsr t1
    ror
    lsr t1
    ror
    lsr t1
    ror
    lsr t1
    ror
    sec
    sbc cam
    sta t0
    lda t1
    sbc cam+1
    sta t1
    lda t0
    clc
    adc #SPR_X
    sta p_sx
    lda t1
    adc #0
    and #1
    sta p_msb
    ; y = (y >> 4) + SPR_Y, shown while it's on the screen
    lda py
    sta t0
    lda py+1
    ldx #4
:   cmp #$80
    ror
    ror t0
    dex
    bne :-
    tax
    beq @below
    cpx #$ff
    bne @hide
    lda t0
    cmp #<(-SPR_Y)
    bcc @hide
    bcs @show
@below:
    lda t0
    cmp #SPR_LOW
    bcs @hide
@show:
    lda t0
    clc
    adc #SPR_Y
    sta p_sy
    lda #1
    bne :+
@hide:
    lda #0
:   sta p_en
    ; the frame: jumping, standing, or one of two running
    ldx #3
    lda ground
    beq :+
    ldx #0
    lda vx
    beq :+
    ldx #1
    lda frm
    and #4
    beq :+
    ldx #2
:   txa
    ldx facing
    beq :+
    clc
    adc #4
:   clc
    adc #SPRPTR
    sta p_ptr
    ; the forest's shift: ceil(cam * 1/4) / 2 fat pixels, mod 16 = (cam + 3) >> 3
    lda cam
    clc
    adc #3
    sta t0
    lda cam+1
    adc #0
    lsr
    ror t0
    lsr
    ror t0
    lsr
    ror t0
    lda t0
    and #15
    sta p_shift

    lda #1
    sta ready
:   ldx $dc05               ; how long it took since the bottom of the frame
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

; Shows the frame view worked out. Called at the bottom of the frame.
apply:
    lda p_d018
    sta $d018
    lda p_xs0
    sta xs0
    lda p_xs1
    sta xs1
    lda p_xs2
    sta xs2
    lda p_sx
    sta $d000
    lda p_msb
    sta $d010
    lda p_sy
    sta $d001
    lda p_en
    sta $d015
    lda p_ptr
    sta SCREEN_A + $3f8
    sta SCREEN_B + $3f8
    ldx p_shift
    cpx shift
    bne :+
    jmp @shown
:   stx shift
.include "back.inc"
@shown:
    lda #0
    sta ready
    lda #1
    sta applied
    rts

; ------------------------------------------------------------------ raster IRQs
; The bottom of the frame: the mountains' colours, then the next frame if it's ready.
irq_bottom:
    sta sa
    stx sx
    sty sy
    lda #FAR_BG
    sta $d021
    lda #FAR_MC1
    sta $d022
    lda #FAR_MC2
    sta $d023
    lda #%00010001          ; restart the frame timer
    sta $dc0e
    lda ready
    beq @late
    jsr apply
    jmp @scroll
@late:
    lda counting
    beq @scroll
    inc missed
    bne @scroll
    inc missed+1
@scroll:
    lda xs0                 ; (the level's scroll is in $D016 until now)
    sta $d016
    lda #IRQ1
    sta $d012
    lda #<irq_split1
    sta $fffe
    lda #>irq_split1
    sta $ffff
    lda #1
    sta $d019
    lda sa
    ldx sx
    ldy sy
    rti

; Mountains to hills: their colours in the mountains' ground (all colour RAM), then the scroll in the
; border between the two bands.
irq_split1:
    sta sa
    stx sx
    sty sy
    lda #HILLS_MC1
    sta $d022
    lda #HILLS_MC2
    sta $d023
    ldx xs1
    lda #SPLIT1 - 1
:   cmp $d012
    bne :-
    delay SPLIT_DELAY
    stx $d016
    lda #IRQ2
    sta $d012
    lda #<irq_split2
    sta $fffe
    lda #>irq_split2
    sta $ffff
    lda #1
    sta $d019
    lda sa
    ldx sx
    ldy sy
    rti

; Hills to the level, the same way.
irq_split2:
    sta sa
    stx sx
    sty sy
    lda #LEVEL_TOP_BG
    sta $d021
    lda #LEVEL_MC1
    sta $d022
    lda #LEVEL_MC2
    sta $d023
    ldx xs2
    lda #SPLIT2 - 1
:   cmp $d012
    bne :-
    delay SPLIT_DELAY
    stx $d016
    lda #IRQ3
    sta $d012
    lda #<irq_sky
    sta $fffe
    lda #>irq_sky
    sta $ffff
    lda #1
    sta $d019
    lda sa
    ldx sx
    ldy sy
    rti

; Behind the treetops the level's background turns from the hills' green to sky.
irq_sky:
    sta sa
    stx sx
    sty sy
    ldx #LEVEL_BG
    lda #SKY - 1
:   cmp $d012
    bne :-
    delay SPLIT_DELAY
    stx $d021
    lda #IRQ_BOTTOM
    sta $d012
    lda #<irq_bottom
    sta $fffe
    lda #>irq_bottom
    sta $ffff
    lda #1
    sta $d019
    lda sa
    ldx sx
    ldy sy
    rti

; ------------------------------------------------------------------ drawing the bands (draw.inc)
.include "draw.inc"

.segment "RODATA"
D018S:   .byte D018_A, D018_B
SOLIDLO:
.repeat LEVEL_H, I
    .byte <(SOLID + I * 128)
.endrepeat
SOLIDHI:
.repeat LEVEL_H, I
    .byte >(SOLID + I * 128)
.endrepeat
.ifdef SCRIPT
SCRIPT_DATA:
.include "script.inc"
.endif

.segment "SPRITES"
    .incbin "sprites.bin"

.segment "CHARSET"
    .incbin "charset.bin"

.segment "HIGH"             ; page-aligned: each row of these is a page
LEVEL:   .incbin "level.bin"
BANDS:   .incbin "bands.bin"
BACKTAB: .incbin "backtab.bin"
SOLID:   .incbin "solid.bin"
