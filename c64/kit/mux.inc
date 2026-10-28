; APEX C64 kit: the sprite multiplexer. More objects than the VIC's 8 sprites, by reusing each
; hardware sprite further down the screen. Include it after kit.inc.
;
; The rule (c64/shmup/view.js multiplex(), which a reference must follow too): objects wholly in the
; border are left out; the rest are taken in order of Y, ties by id, and the n-th one shown gets
; hardware sprite n mod 8, but only if it starts at least MUX_GAP lines below the last object on
; that hardware sprite; otherwise it is left out and the next object tries the same hardware sprite.
; Where sprites overlap, the lower hardware sprite is in front.
;
; The engine defines, before including:
;   MUX_IDS        how many objects there can be (at most MUX_LIST, 32 unless set, up to 64); ids
;                  are their order for ties
;   MUX_GAP        the lines between objects on one hardware sprite
;   MUX_FREE_ROW   the first sprite row that is empty in every frame: a hardware sprite is set up for
;                  its next object from the line its last object draws this row
;   MUX_BOTTOM     the bottom-of-frame IRQ's raster line, after every sprite; and irq_bottom, its
;                  handler, which calls mux_bottom
;
; Each frame, while the last one shows:
;   jsr mux_start, then for each object to show: Y = its id, optr and ocol its sprite pointer and
;   colour, and SHOW xl, xh, yl, yh, L with its screen position (16-bit, the sprite's top left)
;   jsr mux_build   sorts them and gives them hardware sprites, in the list that isn't showing
; In irq_bottom: when the new frame is shown, A = the high byte of its screen's sprite pointers, jsr
; mux_swap; then always jsr mux_bottom (it sets the first 8 and the interrupt for the rest, and
; returns with the IRQ vector set for the next interrupt). Call mux_init once at the start.
;
; latespr counts sprites set up after their first line had begun (none should be).

.ifndef MUX_LIST
MUX_LIST = 32               ; each sprite list's room (an engine may set more, up to 64)
.endif

.segment "ZEROPAGE"
optr:     .res 1            ; SHOW: the object's sprite pointer and colour
ocol:     .res 1
latespr:  .res 2            ; sprites set up late
mux_on:   .res 1            ; objects shown this frame
mux_pn:   .res 1            ; last frame's
mux_nn:   .res 1            ; new this frame
mux_lb:   .res 1            ; the list being built: its first index (0 or MUX_LIST)
mux_msb:  .res 1            ; $D010 so far
mux_disp: .res 1            ; the list showing: 0 or 1
mux_nx:   .res 1            ; the next sprite to set (an index in the list showing)
mux_end:  .res 1            ; and the end of that list
mux_pp:   .res 2            ; the showing screen's sprite pointers
mux_t0:   .res 1
mux_t1:   .res 1
mux_t2:   .res 1
mux_t3:   .res 1
mux_it:   .res 1            ; the IRQ's own
mux_sa:   .res 1            ; registers saved by mux_irq
mux_sx:   .res 1
mux_sy:   .res 1

.segment "BSS"
; the objects to show this frame, by id, and their order down the screen
mux_vis:   .res MUX_LIST    ; 1 shown this frame (back to 0 once in order)
mux_inord: .res MUX_LIST    ; 1 in last frame's order
mux_newl:  .res MUX_LIST    ; shown, and new to the order
o_y:       .res MUX_LIST    ; Y register
o_xl:      .res MUX_LIST    ; X register, low 8 bits
o_xh:      .res MUX_LIST    ; and bit 8
o_ptr:     .res MUX_LIST
o_col:     .res MUX_LIST
mux_order: .res MUX_LIST
mux_prev:  .res MUX_LIST    ; last frame's order, while this frame's is built
; two sprite lists (the one showing, the one being built), MUX_LIST apart: per sprite its Y and X
; registers, $D010 after it, colour, pointer, and the line from which its hardware sprite is free
d_y:       .res 2 * MUX_LIST
d_x:       .res 2 * MUX_LIST
d_msb:     .res 2 * MUX_LIST
d_col:     .res 2 * MUX_LIST
d_ptr:     .res 2 * MUX_LIST
d_e:       .res 2 * MUX_LIST
d_end:     .res 2           ; per list: its end index, $D015, $D010 for its first 8
d_en:      .res 2
d_msb0:    .res 2

; Shows object Y (its id) at xl/xh, yl/yh (pointer optr, colour ocol) unless it's wholly in the
; border: it shows if -17 < y < 196 and -24 < x < 320. One new to the order joins mux_newl. Jumps to
; L if not shown. Keeps X and Y.
.macro SHOW xl, xh, yl, yh, L
    lda yh                  ; y: 0 to 195, or -16 to -1
    beq :+
    cmp #$ff
    bne L
    lda yl
    cmp #<-16
    bcc L
    bcs :++
:   lda yl
    cmp #196
    bcs L
:   lda xl                  ; x + 24: 1 to 343
    clc
    adc #24
    sta o_xl,y
    lda xh
    adc #0
    beq :+
    cmp #1
    bne L
    lda o_xl,y
    cmp #<344
    bcs L
    lda #1
    bne :++
:   lda o_xl,y
    beq L
    lda #0
:   sta o_xh,y
    lda yl
    clc
    adc #50
    sta o_y,y
    lda optr
    sta o_ptr,y
    lda ocol
    sta o_col,y
    lda #1
    sta mux_vis,y
    lda mux_inord,y
    bne :+
    sty mux_t0
    tya
    ldy mux_nn
    sta mux_newl,y
    inc mux_nn
    ldy mux_t0
:
.endmacro

.segment "CODE"
mux_init:
    lda #0
    sta mux_pn
    sta mux_disp
    sta latespr
    sta latespr+1
    ldx #MUX_LIST - 1
:   sta mux_vis,x
    sta mux_inord,x
    dex
    bpl :-
    sta d_end               ; no sprites in either list yet
    sta d_en
    sta d_en+1
    sta d_msb0
    sta d_msb0+1
    lda #MUX_LIST
    sta d_end+1
    rts

mux_start:
    lda #0
    sta mux_nn
    rts

; The order down the screen, then the hardware sprites.
mux_build:
    ; Last frame's order, without the objects gone, then the new ones (in id order), insertion
    ; sorted by (Y, id). As most objects move little from frame to frame, there is little to sort.
    ; Last frame's order (in mux_prev), without the objects gone, then the new ones (in id order),
    ; each placed into this frame's order by (Y, id) as it comes: an insertion sort as they're
    ; gathered. As most objects move little from frame to frame, most go straight at the end.
    ldx mux_pn
:   dex                     ; last frame's order, to read from
    bmi :+
    lda mux_order,x
    sta mux_prev,x
    jmp :-
:   lda #0
    sta mux_on              ; this frame's so far
    sta mux_t3              ; the next of last frame's
@keep:
    ldx mux_t3
    cpx mux_pn
    beq @kept
    inc mux_t3
    ldy mux_prev,x
    lda mux_vis,y
    bne :+
    sta mux_inord,y         ; gone (A is 0)
    jmp @keep
:   lda #0                  ; (vis back to 0 for the next frame)
    sta mux_vis,y
    jsr @insert
    jmp @keep
@kept:
    lda #0
    sta mux_t3
@new:
    ldx mux_t3
    cpx mux_nn
    beq @sorted
    inc mux_t3
    ldy mux_newl,x
    lda #0
    sta mux_vis,y
    lda #1
    sta mux_inord,y
    jsr @insert
    jmp @new
; Object Y into the order so far, after every object with a lower Y, or the same Y and a lower id.
@insert:
    sty mux_t0
    lda o_y,y
    sta mux_t1
    ldx mux_on
    inc mux_on
    cpx #0
    beq @place              ; (the first)
    ldy mux_order-1,x       ; after the last one placed? (most are: objects keep their order)
    cmp o_y,y
    beq :+
    bcs @place
    bcc @move
:   cpy mux_t0
    bcc @place
    jmp @move
@shift:
    cpx #0
    beq @place
    ldy mux_order-1,x
    lda o_y,y
    cmp mux_t1
    bcc @place
    bne @move
    cpy mux_t0              ; the same Y: the lower id first
    bcc @place
@move:
    tya
    sta mux_order,x
    dex
    jmp @shift
@place:
    lda mux_t0
    sta mux_order,x
    rts
@sorted:
    lda mux_on
    sta mux_pn
    ; The n-th object shown gets hardware sprite n mod 8, if it starts MUX_GAP lines below the one
    ; before it on that sprite (the list's entry 8 back).
    lda mux_disp
    eor #1
    beq :+
    lda #MUX_LIST
:   sta mux_lb
    clc
    adc #8
    sta mux_t3              ; the list's 9th place: from there, sprites are reused
    lda #0
    sta mux_msb
    sta mux_t2              ; the next object in order
    ldx mux_lb              ; X: the next place in the list
@mux:
    ldy mux_t2
    cpy mux_on
    beq @muxed
    inc mux_t2
    lda mux_order,y
    tay                     ; Y: the object
    cpx mux_t3
    bcc @take
    lda o_y,y
    sec
    sbc d_y-8,x
    cmp #MUX_GAP
    bcc @mux                ; too close: left out, and the next tries this sprite
    lda d_y-8,x             ; free from the line that one draws MUX_FREE_ROW (C is set)
    adc #MUX_FREE_ROW
    sta d_e,x
@take:
    lda o_y,y
    sta d_y,x
    lda o_xl,y
    sta d_x,x
    lda o_col,y
    sta d_col,x
    lda o_ptr,y
    sta d_ptr,x
    lda o_xh,y              ; $D010 with this one's bit
    beq :+
    lda mux_msb
    ora MUX_BIT,x
    jmp :++
:   lda mux_msb
    and MUX_NOTBIT,x
:   sta mux_msb
    sta d_msb,x
    inx
    jmp @mux
@muxed:
    ldy mux_disp            ; this list's end, $D015, and $D010 after its first 8
    tya
    eor #1
    tay
    txa
    sta d_end,y
    sec
    sbc mux_lb
    cmp #8
    bcc :+
    lda #8
:   sta mux_t0
    tax
    lda MUX_MASK,x
    sta d_en,y
    lda #0
    ldx mux_t0
    beq :+
    txa
    clc
    adc mux_lb
    tax
    lda d_msb-1,x
:   sta d_msb0,y
    rts

; In irq_bottom, when a new frame shows: its list, and its screen's sprite pointers (A: their high
; byte).
mux_swap:
    sta mux_pp+1
    lda #$f8
    sta mux_pp
    lda mux_disp
    eor #1
    sta mux_disp
    rts

; In irq_bottom: the showing list's first 8 sprites, and the interrupt for the rest (mux_irq), or the
; next bottom of the frame.
mux_bottom:
    ldy mux_disp
    lda d_end,y
    sta mux_end
    lda d_en,y
    sta $d015
    lda d_msb0,y
    sta $d010
    ldx #0
    tya
    beq :+
    ldx #MUX_LIST
:   stx mux_nx
.repeat 8, K                 ; the first 8, on hardware sprites 0-7
    cpx mux_end
    bne :+
    jmp @none
:   ldy #K
    lda d_ptr,x
    sta (mux_pp),y
    lda d_col,x
    sta $d027+K
    lda d_y,x
    sta $d001+2*K
    lda d_x,x
    sta $d000+2*K
    inx
.endrepeat
    cpx mux_end
    beq @none
@more:
    stx mux_nx
    lda d_e,x
    sta $d012
    lda #<mux_irq
    sta $fffe
    lda #>mux_irq
    sta $ffff
    rts
@none:
    lda #MUX_BOTTOM
    sta $d012
    lda #<irq_bottom
    sta $fffe
    lda #>irq_bottom
    sta $ffff
    rts

; A sprite's turn: set it, and the ones after it due within a line.
mux_irq:
    sta mux_sa
    stx mux_sx
    sty mux_sy
    IRQ_IN
@next:
    ldx mux_nx
    txa
    and #7
    tay
    lda d_ptr,x
    sta (mux_pp),y
    lda d_col,x
    sta $d027,y
    tya
    asl
    tay
    lda d_y,x
    sta $d001,y
    lda d_x,x
    sta $d000,y
    lda d_msb,x
    sta $d010
    lda $d012               ; too late? (its first line already begun)
    cmp d_y,x
    bcc :+
    lda counting
    beq :+
    inc latespr
    bne :+
    inc latespr+1
:   inx
    stx mux_nx
    cpx mux_end
    beq @last
    lda d_e,x               ; the next: now, after a short wait, or by interrupt
    sec
    sbc $d012
    bcc @next
    beq @next
    cmp #2
    bcs @later
:   lda $d012
    cmp d_e,x
    bcc :-
    jmp @next
@later:
    lda d_e,x
    sta $d012
    jmp @out
@last:
    lda #MUX_BOTTOM
    sta $d012
    lda #<irq_bottom
    sta $fffe
    lda #>irq_bottom
    sta $ffff
@out:
    IRQ_OUT
    lda #1
    sta $d019
    lda mux_sa
    ldx mux_sx
    ldy mux_sy
    rti

.segment "RODATA"
; by place in a list: its hardware sprite's bit in $D010, and the rest
MUX_BIT:
.repeat 2 * MUX_LIST, I
    .byte 1 << (I & 7)
.endrepeat
MUX_NOTBIT:
.repeat 2 * MUX_LIST, I
    .byte $ff ^ (1 << (I & 7))
.endrepeat
MUX_MASK:  .byte 0, 1, 3, 7, 15, 31, 63, 127, 255
.segment "CODE"
