; APEX shoot-'em-up for the Commodore 64: a ship over a space dreadnought that scrolls down the screen a
; line a frame, with drones, swoopers, turrets, bullets and explosions all as hardware sprites, more of
; them than the VIC's eight, at 50 frames a second. It follows the reference (core/shmup.js,
; c64/shmup/view.js) step for step, so every frame is exactly the reference's frame.
;
; The screen is 40 x 24 multicolor characters, moved by the VIC's vertical fine scroll. Every 8 frames
; the screen that isn't showing becomes the shown one moved down a row, copied a few rows at a time
; over the other 7 frames (ahead, when frames have time to spare), with the level's next row at its
; top; the screens swap at the bottom of the frame
; together with the fine scroll. The stars are 32 characters redrawn each frame, in the character set
; that isn't showing (there are two), so they never tear.
;
; The multiplexer: each frame, the objects to show are sorted by Y and given hardware sprites in turn
; by the reference's rule (view.js multiplex()). Sprites 0-7 are set at the bottom of the frame; each
; later one by a raster interrupt as soon as the object before it on that hardware sprite has drawn
; its last row (rows from SPRITE_ROWS on are empty in every frame), and before its own first line.
;
; Controls: joystick in port 2, or W / A / S / D and Space to fire; R restarts.
; Assemble with c64/shmup/build.js. The machine set-up, scripts, timing and profiling come from the kit
; (c64/kit/kit.inc), and the multiplexer is the kit's (c64/kit/mux.inc).

.include "gen.inc"

SCREEN_A = $4000            ; VIC bank 1
SCREEN_B = $4400
CHARS_A  = $4800
CHARS_B  = $5000
SPRITES  = $5800
SPRPTR   = (SPRITES - $4000) / 64
BOTTOM   = 250              ; the bottom-of-frame interrupt, below the 24-row display
N_IDS    = 1 + N_SHOTS + N_ENEMIES + N_BULLETS ; objects: the ship, then the shots, enemies, bullets

MUX_IDS      = N_IDS
MUX_GAP      = GAP
MUX_FREE_ROW = SPRITE_ROWS
MUX_BOTTOM   = BOTTOM
.include "kit.inc"
.include "mux.inc"

.segment "ZEROPAGE"
inp:     .res 1             ; joystick bits: 1 up, 2 down, 4 left, 8 right, 16 fire
t0:      .res 1
t1:      .res 1
t2:      .res 1
t3:      .res 1
dxl:     .res 1             ; a hit test's or aim's dx, dy
dxh:     .res 1
dyl:     .res 1
dyh:     .res 1
ax8:     .res 1             ; aim: |dx| / 2, |dy| / 2
ay8:     .res 1
m2:      .res 2             ; aim: 2, 3 and 5 times |dx| / 2 or |dy| / 2
m3:      .res 2
m5:      .res 2
m2a:     .res 2             ; (those of |dy| / 2)
m3a:     .res 2
m5a:     .res 2
lp:      .res 2             ; a level row
dp:      .res 2             ; a screen row
sp:      .res 2             ; a star texture
jv:      .res 2             ; a routine to call through
sx2:     .res 1             ; X kept by aim
si:      .res 1             ; hit tests: the shot
ax0:     .res 2             ; hit tests: the shot's or the ship's x and y
ay0:     .res 2
wxl:     .res 4             ; shot hits: per enemy kind, the window's corner
wxh:     .res 4
wyl:     .res 4
wyh:     .res 4
; the game (core/shmup.js)
gt:      .res 1             ; the frame count (only its low byte matters)
camyl:   .res 1             ; the level line at the top of the screen
camyh:   .res 1
pxl:     .res 1             ; the ship
pxh:     .res 1
py:      .res 1
pdead:   .res 1
pinv:    .res 1
pcool:   .res 1
score:   .res 2
deaths:  .res 1
hit:     .res 1
; the view
ys:      .res 1             ; the fine scroll
cyr:     .res 1             ; the level's character row at screen row 0
cur:     .res 1             ; this frame's screen: 0 A, 1 B
cdone:   .res 1             ; the other screen's parts done (7: ready)
curcs:   .res 1             ; this frame's character set: 0 A, 1 B
o1:      .res 1             ; the stars' offsets
o2:      .res 1
sid:     .res 1
zero:    .res 1             ; 0
sa:      .res 1             ; registers saved by the IRQs
sx:      .res 1
sy:      .res 1
ready:   .res 1             ; 1: the next frame is worked out (p_*)
applied: .res 1             ; 1: the IRQ showed it
maxcore: .res 2             ; the same, before copying the other screen ahead
p_d018:  .res 1             ; the next frame
p_d011:  .res 1
p_ptr:   .res 1             ; the high byte of its screen's sprite pointers

.segment "BSS"
; enemies, shots, bullets: fixed slots, as in core/shmup.js
e_kind:  .res N_ENEMIES
e_xl:    .res N_ENEMIES
e_xh:    .res N_ENEMIES
e_yl:    .res N_ENEMIES
e_yh:    .res N_ENEMIES
e_bxl:   .res N_ENEMIES
e_bxh:   .res N_ENEMIES
e_vx:    .res N_ENEMIES
e_vy:    .res N_ENEMIES
e_t:     .res N_ENEMIES
e_hp:    .res N_ENEMIES
e_flash: .res N_ENEMIES
e_ground: .res N_ENEMIES
e_phase: .res N_ENEMIES
e_c6:    .res N_ENEMIES         ; a swooper's frames since it turned, mod 6
s_on:    .res N_SHOTS
s_xl:    .res N_SHOTS
s_xh:    .res N_SHOTS
s_yl:    .res N_SHOTS
s_yh:    .res N_SHOTS
b_on:    .res N_BULLETS
b_xl:    .res N_BULLETS             ; 1/16 pixel
b_xh:    .res N_BULLETS
b_yl:    .res N_BULLETS
b_yh:    .res N_BULLETS
b_vx:    .res N_BULLETS
b_vy:    .res N_BULLETS
b_sxl:   .res N_BULLETS             ; whole pixels
b_sxh:   .res N_BULLETS
b_syl:   .res N_BULLETS
b_syh:   .res N_BULLETS
rec_near: .res 8                    ; per character set and texture: the lines its stars are on
rec_far: .res 8

; ------------------------------------------------------------------ 16-bit signed compares
; Jump to L if the signed 16-bit value at lo, hi is below the constant C (jlt), or not (jge).
; (No labels inside, so they don't end the cheap local labels' scope around them.)
.macro jlt lo, hi, C, L
    lda lo
    cmp #<(C)
    lda hi
    sbc #>(C)
    bvc *+4
    eor #$80
    bpl *+5
    jmp L
.endmacro
.macro jge lo, hi, C, L
    lda lo
    cmp #<(C)
    lda hi
    sbc #>(C)
    bvc *+4
    eor #$80
    bmi *+5
    jmp L
.endmacro

; Hit tests: is the object at e_xl/e_yl,x (BOX_TEST, pair Y + off) or bullet X's screen position
; (BOX_TEST_B, pair Y) in the pair's box around ax0, ay0? d = b - a is in range when
; 0 <= d - (lo + 1) < width, unsigned: dy first, as it rules most out. Jumps to L if not.
.macro BOX_TEST off, L
    lda e_yl,x
    sec
    sbc ay0
    sta t0
    lda e_yh,x
    sbc ay0+1
    sta t1
    lda t0
    sec
    sbc HIT_Y0L+(off),y
    sta t0
    lda t1
    sbc HIT_Y0H+(off),y
    bne L
    lda t0
    cmp HIT_YW+(off),y
    bcs L
    lda e_xl,x
    sec
    sbc ax0
    sta t0
    lda e_xh,x
    sbc ax0+1
    sta t1
    lda t0
    sec
    sbc HIT_X0L+(off),y
    sta t0
    lda t1
    sbc HIT_X0H+(off),y
    bne L
    lda t0
    cmp HIT_XW+(off),y
    bcs L
.endmacro
.macro BOX_TEST_B L
    lda b_syl,x
    sec
    sbc ay0
    sta t0
    lda b_syh,x
    sbc ay0+1
    sta t1
    lda t0
    sec
    sbc HIT_Y0L,y
    sta t0
    lda t1
    sbc HIT_Y0H,y
    bne L
    lda t0
    cmp HIT_YW,y
    bcs L
    lda b_sxl,x
    sec
    sbc ax0
    sta t0
    lda b_sxh,x
    sbc ax0+1
    sta t1
    lda t0
    sec
    sbc HIT_X0L,y
    sta t0
    lda t1
    sbc HIT_X0H,y
    bne L
    lda t0
    cmp HIT_XW,y
    bcs L
.endmacro

.segment "CODE"
start:
    KIT_INIT irq_bottom
    lda $dd02               ; VIC bank 1 ($4000-$7FFF)
    ora #3
    sta $dd02
    lda $dd00
    and #$fc
    ora #2
    sta $dd00
    lda #COL_BORDER
    sta $d020
    lda #COL_BG
    sta $d021
    lda #COL_MC1
    sta $d022
    lda #COL_MC2
    sta $d023
    lda #$18                ; multicolor, 40 columns
    sta $d016
    ldx #0                  ; colour RAM: one value, for good
    lda #COL_RAM
:   sta $d800,x
    sta $d900,x
    sta $da00,x
    sta $dae8,x
    inx
    bne :-
    lda #$ff                ; sprites: all multicolor, unexpanded, in front of the characters
    sta $d01c
    lda #0
    sta $d015
    sta $d017
    sta $d01d
    sta $d01b
    sta $d010
    lda #SPR_MC1
    sta $d025
    lda #SPR_MC2
    sta $d026
    ldx #3                  ; both character sets hold the stars as at frame 0
:   lda NEAR_LINE,x
    sta rec_near,x
    sta rec_near+4,x
    lda FAR_LINE,x
    sta rec_far,x
    sta rec_far+4,x
    dex
    bpl :-

    jsr mux_init
    lda #0
    sta zero
    sta maxcore
    sta maxcore+1
    sta applied
    KIT_SCRIPT_START
    jsr reset_game
    jsr view                ; the first frame, before any tick
    lda #1
    sta ready
    lda #BOTTOM
    sta $d012
    lda #1
    sta $d01a
    sta $d019
    cli
:   lda applied             ; wait for it to show
    beq :-
    lda #1
    sta counting

main:
    lda applied             ; wait for the last frame to show
    beq main
    KIT_TIMER_START         ; time this frame's work
    KIT_PROFILE_FRAME
    lda #0
    sta applied
    jsr input
    bcc :+
    jmp kit_park
:   MARK 0
    jsr tick
    MARK 6
    jsr view
@read:
    ldy $dc05               ; the work so far, before copying ahead (read again if the high byte moved)
    ldx $dc04
    cpy $dc05
    bne @read
    txa
    eor #$ff
    cmp maxcore
    tya
    eor #$ff
    sbc maxcore+1
    bcc :+
    txa
    eor #$ff
    sta maxcore
    tya
    eor #$ff
    sta maxcore+1
:   jsr copy_more
    MARK 12
    KIT_TIMER_MAX           ; how long it took
    lda #1
    sta ready
    jmp main

; ------------------------------------------------------------------ controls
; inp from the joystick in port 2 and W / A / S / D / Space; C set when a SCRIPT build's script has
; ended.
input:
.ifdef SCRIPT
    jmp kit_script
.else
    lda #$ff                ; no keyboard row: $DC00 reads the joystick
    sta $dc00
    lda $dc00
    eor #$ff
    and #31
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
:   lda #%01111111          ; row 7: Space (bit 4)
    sta $dc00
    lda $dc01
    and #$10
    bne :+
    lda inp
    ora #16
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
    jsr reset_game          ; R: start again
:   clc
    rts
.endif

; ------------------------------------------------------------------ a new game
reset_game:
    lda #<START_CAMY
    sta camyl
    lda #>START_CAMY
    sta camyh
    lda #0
    sta gt
    sta pdead
    sta pinv
    sta pcool
    sta score
    sta score+1
    sta deaths
    sta cur
    lda #<START_X
    sta pxl
    lda #>START_X
    sta pxh
    lda #START_Y
    sta py
    ldx #N_ENEMIES - 1
    lda #0
:   sta e_kind,x
    dex
    bpl :-
    ldx #N_SHOTS - 1
:   sta s_on,x
    dex
    bpl :-
    ldx #N_BULLETS - 1
:   sta b_on,x
    dex
    bpl :-
    lda #1                  ; so the first frame uses character set A
    sta curcs
    lda #START_CY           ; screen A shows the start; B is ready for the first row down
    sta cyr
    ldx #0
    jsr draw_screen
    ldx cyr
    bne :+
    ldx #LEVEL_ROWS
:   dex
    stx t3
    lda #7
    sta cdone
    ldx #1
    jmp draw_screen

; Screen X (0 A, 1 B) from the level's character row t3 (cyr for X = 0) down: 25 rows.
draw_screen:
    cpx #0
    bne :+
    lda cyr
    sta t3
:   lda SCREEN_HI,x
    sta dp+1
    lda #0
    sta dp
    lda #25
    sta t2
@row:
    ldx t3
    lda ROW_LO,x
    sta lp
    lda ROW_HI,x
    sta lp+1
    ldy #39
:   lda (lp),y
    sta (dp),y
    dey
    bpl :-
    inx
    cpx #LEVEL_ROWS
    bne :+
    ldx #0
:   stx t3
    lda dp
    clc
    adc #40
    sta dp
    bcc :+
    inc dp+1
:   dec t2
    bne @row
    rts

; ------------------------------------------------------------------ one tick (core/shmup.js tick)
tick:
    inc gt

    ; ---- the ship, and its shots
    lda pdead
    beq @alive
    dec pdead
    bne @shots
    lda #<START_X           ; back again, untouchable for a while
    sta pxl
    lda #>START_X
    sta pxh
    lda #START_Y
    sta py
    lda #INVULN
    sta pinv
    lda #0
    sta pcool
    jmp @shots
@alive:
    lda inp
    and #15
    tax
    lda DIR_X,x
    beq @y
    bmi @left
    clc
    adc pxl
    sta pxl
    lda pxh
    adc #0
    sta pxh
    lda pxl                 ; at most BX1
    cmp #<(BX1 + 1)
    lda pxh
    sbc #>(BX1 + 1)
    bcc @y
    lda #<BX1
    sta pxl
    lda #>BX1
    sta pxh
    jmp @y
@left:
    clc
    adc pxl
    sta pxl
    lda pxh
    adc #$ff
    sta pxh
    lda pxl                 ; at least BX0
    cmp #<BX0
    lda pxh
    sbc #>BX0
    bcs @y
    lda #<BX0
    sta pxl
    lda #>BX0
    sta pxh
@y:
    lda DIR_Y,x
    beq @inv
    clc
    adc py
    cmp #BY0
    bcs :+
    lda #BY0
:   cmp #BY1 + 1
    bcc :+
    lda #BY1
:   sta py
@inv:
    lda pinv
    beq @shots
    dec pinv
@shots:
    ldx #N_SHOTS - 1
@shot:
    lda s_on,x
    beq @nshot
    lda s_yl,x
    sec
    sbc #SHOT_SPEED
    sta s_yl,x
    lda s_yh,x
    sbc #0
    sta s_yh,x
    jge {s_yl,x}, {s_yh,x}, -5, @nshot  ; y <= -6: gone
    lda #0
    sta s_on,x
@nshot:
    dex
    bpl @shot
    lda pcool
    beq :+
    dec pcool
:   lda pdead               ; fire
    bne @enemies
    lda inp
    and #16
    beq @enemies
    lda pcool
    bne @enemies
    ldx #0
:   lda s_on,x
    beq @fire
    inx
    cpx #N_SHOTS
    bne :-
    jmp @enemies
@fire:
    lda #1
    sta s_on,x
    lda pxl
    sta s_xl,x
    lda pxh
    sta s_xh,x
    lda py
    sec
    sbc #8
    sta s_yl,x
    lda #0
    sta s_yh,x
    lda #SHOT_COOL
    sta pcool

    ; ---- the enemies
@enemies:
    MARK 1
    ldx #0
@enemy:
    lda e_kind,x
    bne :+
    jmp @nenemy
:   inc e_t,x
    cmp #K_DRONE
    beq @drone
    cmp #K_SWOOPER
    bne :+
    jmp @swooper
:   cmp #K_TURRET
    bne :+
    jmp @turret
:   lda e_ground,x          ; an explosion
    beq :+
    inc e_yl,x
    bne :+
    inc e_yh,x
:   lda e_t,x
    cmp #16
    bcs @free
    jmp @nenemy
@free:
    lda #0
    sta e_kind,x
    jmp @nenemy

@drone:
    lda e_yl,x
    clc
    adc #2
    sta e_yl,x
    bcc :+
    inc e_yh,x
:   lda e_t,x               ; x = bx + SWAY[(t + phase) & 63]
    clc
    adc e_phase,x
    and #63
    tay
    lda SWAY,y
    ldy #0
    ora #0
    bpl :+
    dey
:   clc
    adc e_bxl,x
    sta e_xl,x
    tya
    adc e_bxh,x
    sta e_xh,x
    lda e_yh,x              ; gone at y >= 200
    bne :+
    lda e_yl,x
    cmp #200
    bcc :+
    jmp @free
:   jmp @nenemy

@swooper:
    lda e_t,x
    cmp #20
    bne :+
    jsr fire
    lda e_t,x
:   cmp #36
    bne @sw2
    lda #0                  ; turn away from the middle
    sta e_c6,x
    ldy #2                  ; x + 12 >= 160, i.e. x >= 148 (x is -8 to 304 here)
    lda e_xh,x
    bmi @turnl
    bne @turnr
    lda e_xl,x
    cmp #148
    bcs @turnr
@turnl:
    ldy #$fe
@turnr:
    tya
    sta e_vx,x
    lda e_t,x
@sw2:
    cmp #36
    bcc @sw3
    lda e_c6,x              ; every 6 frames, slow down (then climb) to -3
    bne :+
    lda e_vy,x
    cmp #$fd
    beq :+
    dec e_vy,x
:   ldy e_c6,x
    iny
    cpy #6
    bne :+
    ldy #0
:   tya
    sta e_c6,x
@sw3:
    ldy #0                  ; x += vx, y += vy
    lda e_vx,x
    bpl :+
    dey
:   clc
    adc e_xl,x
    sta e_xl,x
    tya
    adc e_xh,x
    sta e_xh,x
    ldy #0
    lda e_vy,x
    bpl :+
    dey
:   clc
    adc e_yl,x
    sta e_yl,x
    tya
    adc e_yh,x
    sta e_yh,x
    lda e_yh,x              ; gone at y < -21 or y >= 200 (y is -24 to 202)
    beq :+
    lda e_yl,x
    cmp #<-21
    bcc @free2
    bcs @swx
:   lda e_yl,x
    cmp #200
    bcs @free2
@swx:
    lda e_xh,x              ; or x <= -24 or x >= 320 (x is -26 to 322)
    beq @swok
    cmp #1
    beq :+
    lda e_xl,x
    cmp #<-23
    bcc @free2
    bcs @swok
:   lda e_xl,x
    cmp #<320
    bcs @free2
@swok:
    jmp @nenemy
@free2:
    jmp @free

@turret:
    inc e_yl,x
    bne :+
    inc e_yh,x
:   lda e_flash,x
    beq :+
    dec e_flash,x
:   lda e_t,x
    and #63
    cmp #31
    bne @tgone
    lda e_yh,x              ; on the screen's upper part (0 <= y < 140)?
    bne @tgone
    lda e_yl,x
    cmp #140
    bcs @tgone
    jsr fire
@tgone:
    lda e_yh,x              ; gone at y >= 200
    bne @nenemy
    lda e_yl,x
    cmp #200
    bcc @nenemy
    jmp @free

@nenemy:
    inx
    cpx #N_ENEMIES
    beq :+
    jmp @enemy
:

    MARK 2
    ; ---- the bullets
    ldx #N_BULLETS - 1
@bullet:
    lda b_on,x
    bne :+
    jmp @nbullet
:   ldy #0
    lda b_vx,x
    bpl :+
    dey
:   clc
    adc b_xl,x
    sta b_xl,x
    sta t0
    tya
    adc b_xh,x
    sta b_xh,x
    tay                     ; whole pixels: >> 4
    lda ASR4,y
    sta b_sxh,x
    lda SHL4,y
    ldy t0
    ora SHR4,y
    sta b_sxl,x
    ldy #0
    lda b_vy,x
    bpl :+
    dey
:   clc
    adc b_yl,x
    sta b_yl,x
    sta t0
    tya
    adc b_yh,x
    sta b_yh,x
    tay
    lda ASR4,y
    sta b_syh,x
    lda SHL4,y
    ldy t0
    ora SHR4,y
    sta b_syl,x
    lda b_sxh,x             ; gone at x <= -6 or x >= 320
    beq @by
    cmp #1
    beq :+
    cmp #$ff
    bne @bgone
    lda b_sxl,x
    cmp #<-5
    bcc @bgone
    bcs @by
:   lda b_sxl,x
    cmp #<320
    bcs @bgone
@by:
    lda b_syh,x             ; or y <= -6 or y >= 200
    beq :+
    cmp #$ff
    bne @bgone
    lda b_syl,x
    cmp #<-5
    bcc @bgone
    jmp @nbullet
:   lda b_syl,x
    cmp #200
    bcs @bgone
    jmp @nbullet
@bgone:
    lda #0
    sta b_on,x
@nbullet:
    dex
    bmi :+
    jmp @bullet
:

    MARK 3
    ; ---- the level scrolls a line; a tile row now wholly above the screen lets in its spawns
    lda camyl
    bne :+
    lda camyh
    bne :+
    lda #<LEVEL_PX
    sta camyl
    lda #>LEVEL_PX
    sta camyh
:   lda camyl
    bne :+
    dec camyh
:   dec camyl
    lda camyl
    and #15
    cmp #15
    beq :+
    jmp @hits
:   lda camyh               ; the tile row: camY >> 4
    sta t1
    lda camyl
    lsr t1
    ror
    lsr t1
    ror
    lsr t1
    ror
    lsr t1
    ror
    tay
    lda SPAWN_AT,y
    sta t2                  ; the row's first spawn
    lda SPAWN_AT+1,y
    sta t3                  ; and its end
@spawn:
    lda t2
    cmp t3
    bne :+
    jmp @hits
:   tay
    lda SPAWN_TX,y          ; x = tx * 16 - 4
    sta t0
    lda #0
    asl t0
    rol
    asl t0
    rol
    asl t0
    rol
    asl t0
    rol
    sta t1
    lda t0
    sec
    sbc #4
    sta t0
    bcs :+
    dec t1
:   lda SPAWN_KIND,y
    cmp #K_DRONE
    bne @single
    lda #0                  ; a column of four drones, 24 lines apart
    sta sid
@d4:
    jsr free_enemy
    bcc :+
    jmp @nspawn
:   lda #K_DRONE
    sta e_kind,x
    lda t0
    sta e_bxl,x
    sta e_xl,x
    lda t1
    sta e_bxh,x
    sta e_xh,x
    ldy sid
    lda DRONE_Y,y
    sta e_yl,x
    lda #$ff
    sta e_yh,x
    lda #0
    sta e_vx,x
    sta e_vy,x
    sta e_t,x
    sta e_flash,x
    sta e_ground,x
    lda #1
    sta e_hp,x
    tya
    asl
    asl
    asl
    sta e_phase,x
    inc sid
    lda sid
    cmp #4
    bne @d4
    jmp @nspawn
@single:
    pha
    jsr free_enemy
    pla
    bcs @nspawn
    sta e_kind,x
    tay
    lda HP,y
    sta e_hp,x
    lda #0
    sta e_bxl,x
    sta e_bxh,x
    sta e_vx,x
    sta e_t,x
    sta e_flash,x
    sta e_phase,x
    lda t0
    sta e_xl,x
    lda t1
    sta e_xh,x
    lda #$ff
    sta e_yh,x
    cpy #K_SWOOPER
    bne :+
    lda #<-21
    sta e_yl,x
    lda #3
    sta e_vy,x
    lda #0
    sta e_ground,x
    jmp @nspawn
:   lda #<-17
    sta e_yl,x
    lda #0
    sta e_vy,x
    lda #1
    sta e_ground,x
@nspawn:
    inc t2
    jmp @spawn

    ; ---- shots hit enemies
    ; (core/shmup.js also skips enemies at y <= -21, but a shot's box never reaches above y = -15)
@hits:
    MARK 4
    ldy #0
@hshot:
    sty si
    lda s_on,y
    bne :+
    jmp @nhshot
:   lda s_xl,y
    sta ax0
    lda s_xh,y
    sta ax0+1
    lda s_yl,y
    sta ay0
    lda s_yh,y
    sta ay0+1
    ldx #2                  ; per kind (pairs 0-2: the shot and a drone, swooper, turret): the
@win:                       ; lowest x and y it can be hit from, x + lo + 1
    lda ax0
    clc
    adc HIT_X0L,x
    sta wxl+1,x
    lda ax0+1
    adc HIT_X0H,x
    sta wxh+1,x
    lda ay0
    clc
    adc HIT_Y0L,x
    sta wyl+1,x
    lda ay0+1
    adc HIT_Y0H,x
    sta wyh+1,x
    dex
    bpl @win
    ldx #0
@htarget:
    ldy e_kind,x
    beq @nhtarget
    cpy #K_BOOM
    bcs @nhtarget
    lda e_yl,x              ; 0 <= y - wy < width
    sec
    sbc wyl,y
    sta t0
    lda e_yh,x
    sbc wyh,y
    bne @nhtarget
    lda t0
    cmp HIT_YW-1,y
    bcs @nhtarget
    lda e_xl,x
    sec
    sbc wxl,y
    sta t0
    lda e_xh,x
    sbc wxh,y
    bne @nhtarget
    lda t0
    cmp HIT_XW-1,y
    bcs @nhtarget
    ldy si                  ; a hit
    lda #0
    sta s_on,y
    dec e_hp,x
    beq :+
    lda #3
    sta e_flash,x
    jmp @nhshot
:   ldy e_kind,x
    lda SCORE,y
    clc
    adc score
    sta score
    bcc :+
    inc score+1
:   jsr explode
    jmp @nhshot
@nhtarget:
    inx
    cpx #N_ENEMIES
    beq @nhshot
    jmp @htarget
@nhshot:
    ldy si
    iny
    cpy #N_SHOTS
    beq :+
    jmp @hshot
:
    MARK 5

    ; ---- the ship is hit by a bullet or a flying enemy
    lda pdead
    ora pinv
    beq :+
    rts
:   sta hit
    lda pxl
    sta ax0
    lda pxh
    sta ax0+1
    lda py
    sta ay0
    lda #0
    sta ay0+1
    ldx #N_BULLETS - 1
@hbullet:
    lda b_on,x
    beq @nhbullet
    ldy #3                  ; pair 3: the ship and a bullet
    BOX_TEST_B @nhbullet
    lda #0
    sta b_on,x
    lda #1
    sta hit
@nhbullet:
    dex
    bpl @hbullet
    ldx #0
@hflyer:
    ldy e_kind,x
    cpy #K_DRONE
    beq :+
    cpy #K_SWOOPER
    bne @nhflyer
:   BOX_TEST 3, @nhflyer    ; pairs 4, 5: the ship and a drone, swooper
    jsr explode
    lda #1
    sta hit
@nhflyer:
    inx
    cpx #N_ENEMIES
    bne @hflyer
    lda hit
    beq :+
    lda #DEAD_FOR
    sta pdead
    inc deaths
:   rts

; The first free enemy slot in X, or C set if none.
free_enemy:
    ldx #0
:   lda e_kind,x
    beq :+
    inx
    cpx #N_ENEMIES
    bne :-
    sec
    rts
:   clc
    rts

; Enemy X explodes.
explode:
    lda #K_BOOM
    sta e_kind,x
    lda #0
    sta e_t,x
    sta e_flash,x
    rts

; Enemy X fires an aimed bullet, if a bullet is free and the ship is alive. Keeps X.
fire:
    lda pdead
    bne @none
    ldy #0
:   lda b_on,y
    beq @got
    iny
    cpy #N_BULLETS
    bne :-
@none:
    rts
@got:
    sty t3
    ; aim(p.x - e.x, p.y - e.y + 2)
    lda pxl
    sec
    sbc e_xl,x
    sta dxl
    lda pxh
    sbc e_xh,x
    sta dxh
    lda py
    sec
    sbc e_yl,x
    sta dyl
    lda #0
    sbc e_yh,x
    sta dyh
    lda dyl
    clc
    adc #2
    sta dyl
    bcc :+
    inc dyh
:   jsr aim
    ldy t3
    lda AIM_VX,x
    sta b_vx,y
    lda AIM_VY,x
    sta b_vy,y
    ldx sx2
    lda #1
    sta b_on,y
    lda e_xl,x              ; x = (e.x + 9) << 4, y = (e.y + 7) << 4
    clc
    adc #9
    sta t0
    lda e_xh,x
    adc #0
    jsr shl4
    sta b_xh,y
    lda t0
    sta b_xl,y
    lda e_yl,x
    clc
    adc #7
    sta t0
    lda e_yh,x
    adc #0
    jsr shl4
    sta b_yh,y
    lda t0
    sta b_yl,y
    rts

; t0 (low), A (high) << 4; the high byte back in A.
shl4:
    asl t0
    rol
    asl t0
    rol
    asl t0
    rol
    asl t0
    rol
    rts

; The direction (0-15) nearest to (dx, dy), in X (core/shmup.js aim). Saves X in sx2.
aim:
    stx sx2
    lda dxh                 ; |dx| / 2
    sta t1
    lda dxl
    sta t0
    lda t1
    bpl :+
    lda #0
    sec
    sbc t0
    sta t0
    lda #0
    sbc t1
    sta t1
:   lsr t1
    ror t0
    lda t0
    sta ax8
    lda dyh                 ; |dy| / 2
    sta t1
    lda dyl
    sta t0
    lda t1
    bpl :+
    lda #0
    sec
    sbc t0
    sta t0
    lda #0
    sbc t1
    sta t1
:   lsr t1
    ror t0
    lda t0
    sta ay8
    ; q: 5 ay < ax ? 0 : 3 ay < 2 ax ? 1 : 2 ay < 3 ax ? 2 : ay < 5 ax ? 3 : 4
    lda ay8                 ; 2 ay, 3 ay, 5 ay
    jsr mults
    lda m2
    sta m2a
    lda m2+1
    sta m2a+1
    lda m3
    sta m3a
    lda m3+1
    sta m3a+1
    lda m5
    sta m5a
    lda m5+1
    sta m5a+1
    lda ax8                 ; 2 ax, 3 ax, 5 ax
    jsr mults
    ldx #0
    lda m5a                 ; 5 ay < ax
    cmp ax8
    lda m5a+1
    sbc #0
    bcc @q
    inx                     ; 3 ay < 2 ax
    lda m3a
    cmp m2
    lda m3a+1
    sbc m2+1
    bcc @q
    inx                     ; 2 ay < 3 ax
    lda m2a
    cmp m3
    lda m2a+1
    sbc m3+1
    bcc @q
    inx                     ; ay < 5 ax
    lda ay8
    cmp m5
    lda #0
    sbc m5+1
    bcc @q
    inx
@q:
    stx t0                  ; q
    lda dxh
    bmi @left
    lda dyh
    bmi :+
    ldx t0                  ; q
    rts
:   lda #16                 ; 16 - q
    sec
    sbc t0
    and #15
    tax
    rts
@left:
    lda dyh
    bmi :+
    lda #8                  ; 8 - q
    sec
    sbc t0
    tax
    rts
:   lda #8                  ; 8 + q
    clc
    adc t0
    and #15
    tax
    rts

; m2, m3, m5 = 2, 3 and 5 times A (16-bit).
mults:
    sta t0
    asl
    sta m2
    lda #0
    rol
    sta m2+1
    lda m2                  ; 3 = 2 + 1
    clc
    adc t0
    sta m3
    lda m2+1
    adc #0
    sta m3+1
    lda m2                  ; 5 = 2 * 2 + 1
    asl
    sta m5
    lda m2+1
    rol
    sta m5+1
    lda m5
    clc
    adc t0
    sta m5
    bcc :+
    inc m5+1
:   rts

; ------------------------------------------------------------------ the view (c64/shmup/view.js)
view:
    lda curcs               ; this frame's character set, its stars moved on
    eor #1
    sta curcs
    jsr stars
    MARK 7
    lda #3                  ; the fine scroll
    sec
    sbc camyl
    and #7
    sta ys
    bne @noflip
    lda cur                 ; a row down: the other screen, ready since the last
    eor #1
    sta cur
    ldx cyr
    bne :+
    ldx #LEVEL_ROWS
:   dex
    stx cyr
    lda #0                  ; the screen now showing next becomes the other, once this frame shows
    sta cdone
@noflip:
@scrolled:
    MARK 8
    lda ys
    ora #$10                ; display on, 24 rows
    sta p_d011
    ldx cur
    lda D018_SCREEN,x
    ldx curcs
    ora D018_CHARS,x
    sta p_d018
    ldx cur
    lda SCREEN_HI,x
    clc
    adc #3                  ; its sprite pointers, at $3f8
    sta p_ptr
    jmp sprites

call:
    jmp (jv)

; The other screen, a part at a time (c64/shmup/gen.js PARTS): it must be this one moved down a row,
; with the level's row above at its top, by the frame that shows it (fine scroll 0). It is free from
; the frame after the last swap showed (fine scroll 1). So parts are copied ahead while a frame has
; time to spare, by the raster, and the last frame before the swap does what is left.
copy_more:
    lda ys
    beq @done               ; still showing
@part:
    ldx cdone
    cpx #7
    beq @done
    lda ys
    cmp #7
    beq @go                 ; the last chance
    lda $d011               ; time to spare: not within 36 lines before the bottom-of-frame IRQ
    bmi @go
    lda $d012
    cmp #BOTTOM
    bcs @go
    cmp #BOTTOM - 36
    bcs @done
@go:
    txa
    ldy cur
    beq :+
    clc
    adc #7
:   tay
    lda COPY_LO,y
    sta jv
    lda COPY_HI,y
    sta jv+1
    jsr call
    lda cdone
    bne @next
    ldx cyr                 ; with the first part, the top row: the level's row above this one's
    bne :+
    ldx #LEVEL_ROWS
:   dex
    lda ROW_LO,x
    sta lp
    lda ROW_HI,x
    sta lp+1
    lda cur
    eor #1
    tax
    lda SCREEN_HI,x
    sta dp+1
    lda #0
    sta dp
    ldy #39
:   lda (lp),y
    sta (dp),y
    dey
    bpl :-
@next:
    inc cdone
    jmp @part
@done:
    rts

; The stars (view.js starGlyph): in character set curcs, each texture's near and far star moved to
; their lines for this frame.
stars:
    lda gt                  ; o1 = (t >> 1) & 63
    lsr
    and #63
    sta o1
    lda gt                  ; o2 = (3 t >> 2) & 63
    asl
    sta t0
    lda #0
    rol
    sta t1
    lda t0
    clc
    adc gt
    sta t0
    lda t1
    adc #0
    lsr
    ror t0
    lsr
    ror t0
    lda t0
    and #63
    sta o2
    ldx curcs
    lda STARS_LO,x
    sta sp
    lda STARS_HI,x
    sta sp+1
    txa
    asl
    asl
    tax                     ; X: this set's records
    lda #0
    sta sid
@tex:
    lda #0                  ; clear where they were
    ldy rec_near,x
    sta (sp),y
    ldy rec_far,x
    sta (sp),y
    ldy sid
    lda NEAR_LINE,y         ; the near star's line now
    sec
    sbc o1
    and #63
    sta rec_near,x
    lda FAR_LINE,y
    sec
    sbc o2
    and #63
    sta rec_far,x
    lda NEAR_BYTE,y
    ldy rec_near,x
    sta (sp),y
    ldy sid
    lda FAR_BYTE,y
    ldy rec_far,x
    ora (sp),y
    sta (sp),y
    lda sp
    clc
    adc #64
    sta sp
    bcc :+
    inc sp+1
:   inx
    inc sid
    lda sid
    cmp #4
    bne @tex
    rts

; ------------------------------------------------------------------ the sprites
; The objects to show (view.js objects()), sorted down the screen and given hardware sprites by the
; multiplexer's rule (view.js multiplex()), into the list that isn't showing.
sprites:
    jsr mux_start
    lda pdead               ; id 0: the ship, or its explosion
    bne @pboom
    lda pinv
    and #4
    beq :+
    jmp @shots
:   lda gt
    lsr
    lsr
    and #1
    clc
    adc #SPRPTR + F_SHIP0
    ldy #C_SHIP
    jmp @ship
@pboom:
    cmp #DEAD_FOR - 15
    bcc @shots
    lda #DEAD_FOR
    sec
    sbc pdead
    lsr
    lsr
    clc
    adc #SPRPTR + F_BOOM0
    ldy #C_BOOM
@ship:
    sta optr
    sty ocol
    ldy #0
    SHOW pxl, pxh, py, zero, @shots
@shots:
    lda #SPRPTR + F_SHOT
    sta optr
    lda #C_SHOT
    sta ocol
    ldx #0
    ldy #1                  ; ids 1-3: the shots
@shot:
    lda s_on,x
    beq @nshot
    SHOW {s_xl,x}, {s_xh,x}, {s_yl,x}, {s_yh,x}, @nshot
@nshot:
    iny
    inx
    cpx #N_SHOTS
    bne @shot
    ldx #0                  ; ids 4-15: the enemies
@enemy:
    lda e_kind,x
    bne :+
    jmp @nenemy
:   cmp #K_BOOM
    bne @live
    lda e_t,x
    lsr
    lsr
    clc
    adc #SPRPTR + F_BOOM0
    sta optr
    lda #C_BOOM
    sta ocol
    jmp @eadd
@live:
    tay
    lda KIND_COLOR,y
    sta ocol
    lda e_flash,x
    beq @noflash
    lda #C_FLASH
    sta ocol
@noflash:
    cpy #K_DRONE
    bne @other
    lda e_t,x
    lsr
    lsr
    lsr
    and #1
    clc
    adc #SPRPTR + F_DRONE0
    sta optr
    jmp @eadd
@other:
    lda KIND_FRAME,y
    clc
    adc #SPRPTR
    sta optr
@eadd:
    txa
    clc
    adc #1 + N_SHOTS
    tay
    SHOW {e_xl,x}, {e_xh,x}, {e_yl,x}, {e_yh,x}, @nenemy
@nenemy:
    inx
    cpx #N_ENEMIES
    beq :+
    jmp @enemy
:   lda #SPRPTR + F_BULLET
    sta optr
    lda #C_BULLET
    sta ocol
    ldx #0
    ldy #1 + N_SHOTS + N_ENEMIES ; ids 16-21: the bullets
@bullet:
    lda b_on,x
    beq @nbullet
    SHOW {b_sxl,x}, {b_sxh,x}, {b_syl,x}, {b_syh,x}, @nbullet
@nbullet:
    iny
    inx
    cpx #N_BULLETS
    bne @bullet

    MARK 9
    jsr mux_build           ; sorted down the screen and given hardware sprites
    MARK 10
    rts

; ------------------------------------------------------------------ the raster IRQs
; The bottom of the frame: the next frame if it's ready (else this one again), its first 8 sprites,
; and the interrupt for the next sprite.
irq_bottom:
    sta sa
    stx sx
    sty sy
    IRQ_IN
    lda ready
    beq @late
    lda p_d018
    sta $d018
    lda p_d011
    sta $d011
    lda p_ptr
    jsr mux_swap
    lda #0
    sta ready
    lda #1
    sta applied
    jmp @set
@late:
    KIT_LATE
@set:
    jsr mux_bottom
    IRQ_OUT
    lda #1
    sta $d019
    lda sa
    ldx sx
    ldy sy
    rti

.segment "RODATA"
SCREEN_HI:   .byte >SCREEN_A, >SCREEN_B
D018_SCREEN: .byte ((SCREEN_A & $3c00) >> 6), ((SCREEN_B & $3c00) >> 6)
D018_CHARS:  .byte ((CHARS_A & $3800) >> 10), ((CHARS_B & $3800) >> 10)
STARS_LO:    .byte <(CHARS_A + STAR * 8), <(CHARS_B + STAR * 8)
STARS_HI:    .byte >(CHARS_A + STAR * 8), >(CHARS_B + STAR * 8)
COPY_LO:     .lobytes copy_b_0, copy_b_1, copy_b_2, copy_b_3, copy_b_4, copy_b_5, copy_b_6, copy_a_0, copy_a_1, copy_a_2, copy_a_3, copy_a_4, copy_a_5, copy_a_6
COPY_HI:     .hibytes copy_b_0, copy_b_1, copy_b_2, copy_b_3, copy_b_4, copy_b_5, copy_b_6, copy_a_0, copy_a_1, copy_a_2, copy_a_3, copy_a_4, copy_a_5, copy_a_6
DRONE_Y:     .byte <-21, <-45, <-69, <-93
; >> 4 of a signed 16-bit value: low byte SHR4[lo] | SHL4[hi], high byte ASR4[hi]
.align 256
SHR4:
.repeat 256, I
    .byte I >> 4
.endrepeat
SHL4:
.repeat 256, I
    .byte (I << 4) & 255
.endrepeat
ASR4:
.repeat 256, I
    .byte ((I ^ $80) - $80) >> 4 & 255
.endrepeat
; hit-test pairs (c64/shmup/gen.js): 0-2 a shot and a drone, swooper, turret; 3 the ship and a
; bullet; 4, 5 the ship and a drone, swooper. Each axis: lo + 1 (16-bit) and the width of the open
; range (lo, hi).
HIT_X0L:     .lobytes HS_DRONE_X0 + 1, HS_SWOOPER_X0 + 1, HS_TURRET_X0 + 1, HP_BULLET_X0 + 1, HP_DRONE_X0 + 1, HP_SWOOPER_X0 + 1
HIT_X0H:     .hibytes HS_DRONE_X0 + 1, HS_SWOOPER_X0 + 1, HS_TURRET_X0 + 1, HP_BULLET_X0 + 1, HP_DRONE_X0 + 1, HP_SWOOPER_X0 + 1
HIT_XW:      .byte HS_DRONE_X1 - HS_DRONE_X0 - 1, HS_SWOOPER_X1 - HS_SWOOPER_X0 - 1, HS_TURRET_X1 - HS_TURRET_X0 - 1
             .byte HP_BULLET_X1 - HP_BULLET_X0 - 1, HP_DRONE_X1 - HP_DRONE_X0 - 1, HP_SWOOPER_X1 - HP_SWOOPER_X0 - 1
HIT_Y0L:     .lobytes HS_DRONE_Y0 + 1, HS_SWOOPER_Y0 + 1, HS_TURRET_Y0 + 1, HP_BULLET_Y0 + 1, HP_DRONE_Y0 + 1, HP_SWOOPER_Y0 + 1
HIT_Y0H:     .hibytes HS_DRONE_Y0 + 1, HS_SWOOPER_Y0 + 1, HS_TURRET_Y0 + 1, HP_BULLET_Y0 + 1, HP_DRONE_Y0 + 1, HP_SWOOPER_Y0 + 1
HIT_YW:      .byte HS_DRONE_Y1 - HS_DRONE_Y0 - 1, HS_SWOOPER_Y1 - HS_SWOOPER_Y0 - 1, HS_TURRET_Y1 - HS_TURRET_Y0 - 1
             .byte HP_BULLET_Y1 - HP_BULLET_Y0 - 1, HP_DRONE_Y1 - HP_DRONE_Y0 - 1, HP_SWOOPER_Y1 - HP_SWOOPER_Y0 - 1

.include "copy.inc"

.segment "CHARS_A"
    .incbin "charset.bin"
.segment "CHARS_B"
    .incbin "charset.bin"
.segment "SPRITES"
    .incbin "sprites.bin"
.segment "HIGH"
ROWS:    .incbin "rows.bin"
