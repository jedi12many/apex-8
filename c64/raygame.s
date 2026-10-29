; The raycaster's game on the C64, tick for tick as core/raygame.js: the pistol (cooling, flashing),
; guards that die when shot, treasure to pick up, and the score. Included by apex.s (its controls call
; game_timers, pickup and fire each tick; after a frame's cast and project, resolve finds what a shot
; hit). Anything that changes what's shown sets dirty, so the frame is drawn again.

.segment "BSS"
OBJ_ON:  .res 16            ; per object: still there
OBJ_HIT: .res 16            ; per object: ticks left showing white after a shot (then gone)
score:   .res 2             ; BCD, 4 digits (score+1 the high two)
cool:    .res 1             ; ticks until the pistol can fire again
flash:   .res 1             ; ticks left of the muzzle flash
shot:    .res 1             ; 1: fired this tick; resolve still to do
dirty:   .res 1             ; 1: something shown changed besides the pose
best:    .res 1             ; resolve: the guard hit so far ($FF: none), its depth
bestd:   .res 2
lim:     .res 2

.segment "HICODE"
; A new game: everything back, nothing firing.
game_init:
    ldx #15
:   lda #1
    sta OBJ_ON,x
    lda #0
    sta OBJ_HIT,x
    dex
    bpl :-
    lda #0
    sta score
    sta score+1
    sta cool
    sta flash
    sta shot
    sta dirty
    rts

; Step 1 of a tick: the pistol's timers, and shot guards falling.
game_timers:
    lda cool
    beq :+
    dec cool
:   lda flash
    beq :+
    dec flash
    bne :+
    inc dirty               ; the flash is over
:
.if NOBJ > 0
    ldx #NOBJ - 1
@obj:
    lda OBJ_HIT,x
    beq @next
    dec OBJ_HIT,x
    bne @next
    lda #0                  ; gone
    sta OBJ_ON,x
    inc dirty
@next:
    dex
    bpl @obj
.endif
    rts

; Step 3: treasure within PICK_RADIUS on both axes is picked up.
pickup:
.if NOBJ > 0
    ldx #NOBJ - 1
@obj:
    lda OBJT,x
    cmp #T_TREASURE
    bne @next
    lda OBJ_ON,x
    beq @next
    sec                     ; -R <= px - x < R
    lda px
    sbc OBJXLO,x
    sta t0
    lda px+1
    sbc OBJXHI,x
    sta t1
    clc
    lda t0
    adc #PICK_RADIUS
    sta t0
    lda t1
    adc #0
    bne @next
    lda t0
    cmp #2 * PICK_RADIUS
    bcs @next
    sec                     ; and -R <= py - y < R
    lda py
    sbc OBJYLO,x
    sta t0
    lda py+1
    sbc OBJYHI,x
    sta t1
    clc
    lda t0
    adc #PICK_RADIUS
    sta t0
    lda t1
    adc #0
    bne @next
    lda t0
    cmp #2 * PICK_RADIUS
    bcs @next
    lda #0
    sta OBJ_ON,x
    inc dirty
    lda #<TREASURE_BCD
    ldy #>TREASURE_BCD
    jsr add_score
    lda #SFX_PICKUP
    jsr fx
@next:
    dex
    bpl @obj
.endif
    rts

; Step 4: fire, if the trigger is held and the pistol is cool. C set if it fired: the tick stops
; here, and the caller casts from this pose for resolve.
fire:
    lda inp
    and #16
    beq @no
    lda cool
    bne @no
    lda #COOL
    sta cool
    lda #FLASH
    sta flash
    lda #1
    sta shot
    sta dirty
    lda #SFX_SHOT
    jsr fx
    sec
    rts
@no:
    clc
    rts

; After a shot's cast and project: the nearest guard over the middle of the screen (its centre within
; H / 8 + 4 pixels of x 160, H = (2 * halfH * GUARD_H) >> 8) and nearer than the middle ray's wall is
; hit. At the same depth the first in the level wins.
resolve:
    lda #0
    sta shot
    lda #$ff
    sta best
.if NOBJ > 0
    ldx #0
    beq @obj
@skip:
    jmp @next
@obj:
    stx ob
    lda OBJT,x
    cmp #T_GUARD
    bne @skip
    lda OBJ_ON,x
    beq @skip
    lda OBJ_HIT,x
    bne @skip
    lda OV,x
    beq @skip
    lda ODLO,x              ; depth < the middle ray's
    cmp PERPLO + RAYS / 2
    lda ODHI,x
    sbc PERPHI + RAYS / 2
    bcs @skip
    lda OHLO,x              ; lim = H / 8 + 4
    sta m_b
    lda OHHI,x
    sta m_b+1
    lda #GUARD_H
    jsr mul8x16
    asl m_r
    rol m_r+1
    rol m_r+2
    lda m_r+2
    sta lim+1
    lda m_r+1
    ldy #3
:   lsr lim+1
    ror
    dey
    bne :-
    clc
    adc #4
    sta lim
    bcc :+
    inc lim+1
:   ldx ob                  ; |centre - 160|
    sec
    lda OCLO,x
    sbc #160
    sta t0
    lda OCHI,x
    sbc #0
    sta t1
    bpl :+
    lda #0
    sec
    sbc t0
    sta t0
    lda #0
    sbc t1
    sta t1
:   lda t0                  ; must be under lim
    cmp lim
    lda t1
    sbc lim+1
    bcs @next
    ldy best                ; the nearest so far?
    bmi @take
    lda ODLO,x
    cmp bestd
    lda ODHI,x
    sbc bestd+1
    bcs @next
@take:
    stx best
    lda ODLO,x
    sta bestd
    lda ODHI,x
    sta bestd+1
@next:
    ldx ob
    inx
    cpx #NOBJ
    beq :+
    jmp @obj
:
    ldx best
    bmi @none
    lda #HIT
    sta OBJ_HIT,x
    lda #<GUARD_BCD
    ldy #>GUARD_BCD
    jsr add_score
    lda #SFX_DIE
    jsr fx
@none:
.endif
    rts

; score += A + Y * 256 (BCD), with the IRQ held off (it must not run in decimal mode).
add_score:
    php
    sei
    sed
    clc
    adc score
    sta score
    tya
    adc score+1
    sta score+1
    cld
    plp
    rts

; Effect A, with the IRQ held off (it ticks the sound).
fx:
    php
    sei
    jsr snd_fx
    plp
    rts

; The pistol for the hidden screen's sprite 0: its place, colour (flashing or not) and image.
gun:
    lda buf
    asl
    asl
    asl
    tay
    lda #GUN_X
    sta SHX,y
    lda #GUN_Y
    sta SHY,y
    ldx #0                  ; idle
    lda flash
    beq :+
    inx
:   lda GUNCOL,x
    sta SHC,y
    lda GUNPTR,x
    ldx buf
    bne :+
    sta SCREEN_A + $3f8
    rts
:   sta SCREEN_B + $3f8
    rts

.segment "RODATA"
GUNCOL:  .byte GUN_IDLE, GUN_FLASH
GUNPTR:  .byte GUN_BLK0 / 64, GUN_BLK1 / 64
