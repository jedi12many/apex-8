; The platformer's game (core/platform.js game, play), included by side.s: coins, beetles and the flag
; on the level, step for step as the reference. The tables (objects.inc, from gen.js) hold the beetles'
; starts and the items (coins and the flag) left to right, with ITEM_FIRST[c] the first item in block
; column c or after, so only the items near the player (for touching) or on the screen (for sprites)
; are looked at.

.segment "BSS"
b_on:     .res N_BEETLES     ; per beetle: alive, x (12.4), velocity (signed), ticks left squashed
b_xlo:    .res N_BEETLES
b_xhi:    .res N_BEETLES
b_vx:     .res N_BEETLES
b_dying:  .res N_BEETLES
b_pxlo:   .res N_BEETLES     ; per beetle: its left in pixels (x >> 4), kept as it moves
b_pxhi:   .res N_BEETLES
i_on:     .res N_ITEMS       ; per item: not yet taken
gt:       .res 1             ; the game's tick (the animations follow it)
won:      .res 1             ; ticks left showing the win
invuln:   .res 1             ; ticks left safe after a hurt
vy0:      .res 1             ; vy before this tick's move
fell:     .res 1             ; 1: the move fell into a pit
ox:       .res 2             ; touch: the object's box, left, top (12.4), width, height
oy:       .res 2
ow:       .res 2
oh:       .res 2
ilast:    .res 1             ; the last block column an item loop looks at
; the objects shown as sprites: the beetles on the screen by distance, then the merge
nsl:      .res 1             ; hardware sprites given so far
nb:       .res 1             ; beetles on the screen
bd_lo:    .res N_BEETLES + 1 ; their distances and numbers, nearest first
bd_hi:    .res N_BEETLES + 1
bd_i:     .res N_BEETLES + 1
bi:       .res 1             ; the beetles' next, the left run's, the right run's, the left run's end
li:       .res 1
ri:       .res 1
ilo:      .res 1
ihi:      .res 1
bdl:      .res 1             ; the three runs' next distances
bdh:      .res 1
ldl:      .res 1
ldh:      .res 1
rdl:      .res 1
rdh:      .res 1
c_y:      .res 1             ; the sprite being given
c_ptr:    .res 1
c_col:    .res 1
pc:       .res 2             ; the player's middle across, pixels
camr:     .res 2             ; the screen's edges for an object's left: cam + 344, cam - 24
caml:     .res 2
p_on:     .res 1             ; the next frame's object sprites (hardware sprites 1-7)
p_ox:     .res 7
p_oy:     .res 7
p_optr:   .res 7
p_ocol:   .res 7
p_omsb:   .res 1             ; their x bit 8s (bits 1-7, as $D010) and which are shown (as $D015)
p_oen:    .res 1

.segment "CODE"
; A new game: the player at the start, every object back.
reset_game:
    jsr reset_player
    ldx #N_BEETLES - 1
:   lda #1
    sta b_on,x
    lda B_X0LO,x
    sta b_xlo,x
    lda B_X0HI,x
    sta b_xhi,x
    lda #<(-BEETLE_SPEED)
    sta b_vx,x
    lda #0
    sta b_dying,x
    jsr beetle_px
    dex
    bpl :-
    ldx #N_ITEMS - 1
    lda #1
:   sta i_on,x
    dex
    bpl :-
    lda #0
    sta gt
    sta won
    sta invuln
    rts

; One tick of the game: the player (tick), then each beetle, then the items near the player.
play:
    inc gt
    lda won
    beq @live
    dec won                 ; showing the win: nothing moves, and then a new game
    bne :+
    jsr reset_game
:   rts
@live:
    lda vy
    sta vy0
    lda #0
    sta fell
    jsr tick
    lda vy                  ; a jump: its speed, gravity already on it
    cmp #<(GRAVITY - JUMP)
    bne :+
    cmp vy0
    beq :+
    lda #SFX_JUMP
    jsr snd_fx
:   lda fell
    beq :+
    lda #SFX_FALL
    jsr snd_fx
:   lda invuln
    beq :+
    dec invuln
:   jsr beetles
    jmp items

; C set if the player's box (px, py; 12 x 20 pixels) and the object's (ox, oy, ow, oh) overlap.
; Every value is small enough for 16-bit signed differences.
touch:
    lda ox                  ; px < ox + ow
    clc
    adc ow
    sta t0
    lda ox+1
    adc ow+1
    sta t1
    lda px
    cmp t0
    lda px+1
    sbc t1
    bpl @no
    lda px                  ; ox < px + 192
    clc
    adc #<192
    sta t0
    lda px+1
    adc #>192
    sta t1
    lda ox
    cmp t0
    lda ox+1
    sbc t1
    bpl @no
    lda oy                  ; py < oy + oh
    clc
    adc oh
    sta t0
    lda oy+1
    adc oh+1
    sta t1
    lda py
    cmp t0
    lda py+1
    sbc t1
    bvc :+
    eor #$80
:   bpl @no
    lda py                  ; oy < py + 320
    clc
    adc #<320
    sta t0
    lda py+1
    adc #>320
    sta t1
    lda oy
    cmp t0
    lda oy+1
    sbc t1
    bvc :+
    eor #$80
:   bpl @no
    sec
    rts
@no:
    clc
    rts

; Beetle X's left in pixels (x >> 4), kept in b_px. Keeps X.
beetle_px:
    lda b_xhi,x
    sta t1
    lda b_xlo,x
    ldy #4
:   lsr t1
    ror
    dey
    bne :-
    sta b_pxlo,x
    lda t1
    sta b_pxhi,x
    rts

beetles:
    ldx #0
@one:
    lda b_on,x
    bne :+
    jmp @next
:   lda b_dying,x
    beq @walk
    dec b_dying,x           ; squashed, then gone
    bne :+
    lda #0
    sta b_on,x
:   jmp @next
@walk:
    lda b_vx,x              ; nx = x + vx; past its patrol's end (B_MIN going left, B_MAX going right): turn
    bmi @left
    clc
    adc b_xlo,x
    sta nx
    lda b_xhi,x
    adc #0
    sta nx+1
    lda B_MAXLO,x
    cmp nx
    lda B_MAXHI,x
    sbc nx+1
    bcc @turn
    bcs @step
@left:
    clc
    adc b_xlo,x
    sta nx
    lda b_xhi,x
    adc #$ff
    sta nx+1
    bmi @turn               ; (past the level's left)
    lda nx
    cmp B_MINLO,x
    lda nx+1
    sbc B_MINHI,x
    bcc @turn
@step:
    lda nx
    sta b_xlo,x
    lda nx+1
    sta b_xhi,x
    jsr beetle_px
    jmp @meet
@turn:
    lda #0
    sec
    sbc b_vx,x
    sta b_vx,x
@meet:
    lda b_xhi,x             ; meeting the player? (not unless their block columns are within 1)
    sec
    sbc px+1
    clc
    adc #1
    cmp #3
    bcc :+
    jmp @next
:   lda b_xlo,x
    sta ox
    lda b_xhi,x
    sta ox+1
    lda B_YLO,x
    sta oy
    lda B_YHI,x
    sta oy+1
    lda #<BEETLE_W
    sta ow
    lda #>BEETLE_W
    sta ow+1
    lda #<BEETLE_H
    sta oh
    lda #>BEETLE_H
    sta oh+1
    stx t4
    jsr touch
    ldx t4
    bcc @next
    lda vy                  ; landing on it (falling, its feet within STOMP of its top): a stomp
    beq @hurt
    bmi @hurt
    lda py
    clc
    adc #<(320 - STOMP)
    sta t0
    lda py+1
    adc #>(320 - STOMP)
    sta t1
    lda t0
    cmp oy
    lda t1
    sbc oy+1
    bvc :+
    eor #$80
:   bpl @hurt
    lda #DYING
    sta b_dying,x
    lda #<(-BOUNCE)
    sta vy
    lda #SFX_STOMP
    jsr snd_fx
    jmp @next
@hurt:
    lda invuln              ; any other touch: back to the start, safe for a while
    bne @next
    jsr reset_player
    lda #INVULN
    sta invuln
    lda #SFX_HURT
    jsr snd_fx
    ldx t4
@next:
    inx
    cpx #N_BEETLES
    beq :+
    jmp @one
:   rts

; The items the player can touch: from the block column before its own to the one after.
items:
    ldy px+1
    iny
    iny
    sty ilast
    ldy px+1
    beq :+
    dey
:   ldx ITEM_FIRST,y
@one:
    cpx #N_ITEMS
    bcs @done
    lda I_XHI,x
    cmp ilast
    bcs @done
    lda i_on,x
    beq @next
    lda I_XLO,x
    sta ox
    lda I_XHI,x
    sta ox+1
    lda I_YLO,x
    sta oy
    lda I_YHI,x
    sta oy+1
    lda #<ITEM_W
    sta ow
    lda #>ITEM_W
    sta ow+1
    lda I_HLO,x
    sta oh
    lda I_HHI,x
    sta oh+1
    stx t4
    jsr touch
    ldx t4
    bcc @next
    lda I_COIN,x
    beq @flag
    lda #0                  ; a coin: taken
    sta i_on,x
    lda #SFX_COIN
    jsr snd_fx
    jmp @next
@flag:
    lda #WIN_FOR            ; the flag: won
    sta won
    lda #SFX_WIN
    jsr snd_fx
@next:
    inx
    jmp @one
@done:
    rts

; The objects shown as sprites (view.js objectSprites): of the beetles and the items on the screen, the
; 7 nearest the player across, by their middles; ties: beetles first, then items, each in order. The
; items are in order across, so their distances fall towards the player and rise past it: two runs
; already in order (leftwards from the player, rightwards from it). The beetles (few) are put in order
; by insertion; then the three runs are merged, nearest first, for 7.
objsprites:
    lda px                  ; pc = (px + 96) >> 4
    clc
    adc #96
    sta pc
    lda px+1
    adc #0
    ldx #4
:   lsr
    ror pc
    dex
    bne :-
    sta pc+1
    lda cam                 ; the right edge for an object's left: cam + 344
    clc
    adc #<344
    sta camr
    lda cam+1
    adc #>344
    sta camr+1
    lda cam                 ; the left edge: an object's left must be past cam - 24
    sec
    sbc #24
    sta caml
    lda cam+1
    sbc #0
    sta caml+1

    ; the beetles on the screen, by distance (insertion; ties after)
    lda #0
    sta nb
    ldx #0
@beetle:
    lda b_on,x
    beq @bnext
    lda b_pxlo,x            ; its left in pixels
    sta t0
    lda b_pxhi,x
    sta t1
    jsr onscreen
    bcc @bnext
    lda t0                  ; its middle: left + 8; distance |middle - pc|
    clc
    adc #BEETLE_W / 32
    sta t2
    lda t1
    adc #0
    sta t3
    jsr distance
    ldy nb                  ; insert at Y: after any no farther
@bins:
    cpy #0
    beq @bput
    lda t2
    cmp bd_lo-1,y
    lda t3
    sbc bd_hi-1,y
    bcs @bput
    lda bd_lo-1,y
    sta bd_lo,y
    lda bd_hi-1,y
    sta bd_hi,y
    lda bd_i-1,y
    sta bd_i,y
    dey
    jmp @bins
@bput:
    lda t2
    sta bd_lo,y
    lda t3
    sta bd_hi,y
    txa
    sta bd_i,y
    inc nb
@bnext:
    inx
    cpx #N_BEETLES
    bne @beetle

    MARK 5
    ; the items on the screen are those from ilo up to (not) ihi: ilo the first whose left is past
    ; caml, ihi the first whose left is at or past camr (ITEM_FIRST gets near: an item in block column
    ; c or after has its left at 16c or more)
    ldx #0
    lda caml+1
    bmi @lodone             ; (the screen's left is past the level's: all)
    sta t1
    lda caml
    ldy #4
:   lsr t1
    ror
    dey
    bne :-
    tay
    ldx ITEM_FIRST,y
@lo:
    cpx #N_ITEMS
    bcs :+
    lda caml
    cmp I_PXLO,x
    lda caml+1
    sbc I_PXHI,x
    bcc :+                  ; caml < its left: on
    inx
    bne @lo
:
@lodone:
    stx ilo
    lda camr+1
    sta t1
    lda camr
    ldy #4
:   lsr t1
    ror
    dey
    bne :-
    tay
    ldx ITEM_FIRST,y
@hi:
    cpx #N_ITEMS
    bcs :+
    lda I_PXLO,x
    cmp camr
    lda I_PXHI,x
    sbc camr+1
    bcs :+                  ; its left >= camr: off
    inx
    bne @hi
:   stx ihi
    ; the first whose middle is at or past the player's: the right run starts there; the left run
    ; goes back from the one before
    ldx ilo
@seek:
    cpx ihi
    bcs @found
    lda I_CXLO,x
    cmp pc
    lda I_CXHI,x
    sbc pc+1
    bcs @found
    inx
    bne @seek
@found:
    stx ri                  ; the right run's next
    dex
    stx li                  ; the left run's next (below ilo, or $FF: none)
    lda #0
    sta bi                  ; the beetles' next
    sta nsl
    sta p_omsb
    sta p_oen
    MARK 6
    jsr left_item           ; each item run's next, its distance in its d (or $FFFF: none)
    jsr right_item

@pick:
    lda nsl
    cmp #7
    bne :+
    jmp @end
:   ldy bi                  ; the beetles'
    cpy nb
    bcc :+
    lda #$ff
    sta bdl
    sta bdh
    bne @cmp
:   lda bd_lo,y
    sta bdl
    lda bd_hi,y
    sta bdh
@cmp:
    ; the nearest: a beetle, then the left run, then the right, on a tie
    lda ldl                 ; (the left run's nearer than the beetle: not the beetle)
    cmp bdl
    lda ldh
    sbc bdh
    bcc @notb
    lda rdl                 ; (nor if the right run's is)
    cmp bdl
    lda rdh
    sbc bdh
    bcc @notb
    lda bdl                 ; (none at all: done)
    and bdh
    cmp #$ff
    bne :+
    jmp @end
:   ldy bi
    ldx bd_i,y
    inc bi
    jsr show_beetle
    jmp @pick
@notb:
    lda rdl                 ; the right run's nearer than the left's: the right
    cmp ldl
    lda rdh
    sbc ldh
    bcc @right
    lda ldl                 ; (none at all: done)
    and ldh
    cmp #$ff
    bne :+
    jmp @end
:   ldx li
    dec li
    jsr show_item
    jsr left_item
    jmp @pick
@right:
    ldx ri
    inc ri
    jsr show_item
    jsr right_item
    jmp @pick
@end:
    MARK 7
    rts

; The left run's next item not taken (li going down to ilo): its distance in ldl/ldh, or $FFFF.
left_item:
    ldx li
@try:
    cpx #$ff
    beq @none
    cpx ilo
    bcc @none
    lda i_on,x
    bne :+
    dex                     ; (below 0: $FF, none)
    jmp @try
:   stx li
    lda pc                  ; distance: pc - middle
    sec
    sbc I_CXLO,x
    sta ldl
    lda pc+1
    sbc I_CXHI,x
    sta ldh
    rts
@none:
    stx li
    lda #$ff
    sta ldl
    sta ldh
    rts

; The right run's next item not taken (ri going up to ihi): its distance in rdl/rdh, or $FFFF.
right_item:
    ldx ri
@try:
    cpx ihi
    bcs @none
    lda i_on,x
    bne :+
    inx
    bne @try
:   stx ri
    lda I_CXLO,x            ; distance: middle - pc
    sec
    sbc pc
    sta rdl
    lda I_CXHI,x
    sbc pc+1
    sta rdh
    rts
@none:
    stx ri
    lda #$ff
    sta rdl
    sta rdh
    rts

; C set if an object whose left is t0/t1 (pixels) is on the screen: past cam - 24 and before cam + 344.
onscreen:
    lda caml
    cmp t0
    lda caml+1
    sbc t1
    bvc :+
    eor #$80
:   bpl @no                 ; caml >= left
    lda t0
    cmp camr
    lda t1
    sbc camr+1
    bvc :+
    eor #$80
:   bpl @no                 ; left >= camr
    sec
    rts
@no:
    clc
    rts

; t2/t3 = |middle (t2/t3) - pc|.
distance:
    lda t2
    sec
    sbc pc
    sta t2
    lda t3
    sbc pc+1
    sta t3
    bpl :+
    lda #0
    sec
    sbc t2
    sta t2
    lda #0
    sbc t3
    sta t3
:   rts

; Beetle X onto the next hardware sprite (nsl + 1).
show_beetle:
    lda b_pxlo,x            ; middle = (x >> 4) + 8
    clc
    adc #BEETLE_W / 32
    sta t2
    lda b_pxhi,x
    adc #0
    sta t3
    lda B_SY,x
    sta c_y
    lda #COL_BEETLE
    sta c_col
    ldy #F_SQUASHED
    lda b_dying,x
    bne :+
    lda gt
    lsr
    lsr
    lsr
    and #1
    clc
    adc #F_BEETLE0
    tay
:   sty c_ptr
    jmp put_sprite

; Item X onto the next hardware sprite.
show_item:
    lda I_CXLO,x
    sta t2
    lda I_CXHI,x
    sta t3
    lda I_SY,x
    sta c_y
    lda gt
    ldy I_COIN,x
    beq @flag
    lsr                     ; a coin: (t >> 3) & 3 -> coin0, coin1, coin2, coin1
    lsr
    lsr
    and #3
    tay
    lda COIN_FRAMES,y
    sta c_ptr
    lda #COL_COIN
    sta c_col
    jmp put_sprite
@flag:
    lsr
    lsr
    lsr
    lsr
    and #1
    clc
    adc #F_FLAG0
    sta c_ptr
    lda #COL_FLAG
    sta c_col
    ; (fall through)

; The next hardware sprite (nsl + 1): x = middle (t2/t3) - cam + 12, y c_y, image c_ptr, colour c_col.
put_sprite:
    ldy nsl
    lda t2
    sec
    sbc cam
    sta t0
    lda t3
    sbc cam+1
    sta t1
    lda t0
    clc
    adc #12
    sta p_ox,y
    lda t1
    adc #0
    and #1
    beq :+
    lda SPRBIT,y
    ora p_omsb
    sta p_omsb
:   lda c_y
    sta p_oy,y
    lda c_ptr
    clc
    adc #SPRPTR
    sta p_optr,y
    lda c_col
    sta p_ocol,y
    lda SPRBIT,y
    ora p_oen
    sta p_oen
    inc nsl
    rts

.segment "RODATA"
COIN_FRAMES: .byte F_COIN0, F_COIN1, F_COIN2, F_COIN1
SPRBIT:      .byte 2, 4, 8, 16, 32, 64, 128
.include "objects.inc"
.segment "CODE"
