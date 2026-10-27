; Objects as hardware sprites, exactly as c64/sprites.js places them:
;   project  every object: depth, screen centre and half wall height (signed multiplies, divides)
;   sort     the visible ones nearest first (stable, like the reference)
;   cut      each into masked 24x21 tiles from its pre-scaled image, into the hidden screen's sprite
;            blocks, with that screen's sprite registers kept in a shadow set for the IRQ to load
; Included by apex.s; the tables come from gen.inc.

SPR_A    = $3000            ; sprite blocks for screen A ($C0-$C7) and screen B ($C8-$CF)
VIEW_PX  = VIEW_ROWS * 8

.segment "ZEROPAGE"
ob:      .res 1
cs:      .res 2             ; cos and sin of the heading, signed, 256 = 1
sn:      .res 2
dxs:     .res 2             ; object - player, 8.8 tiles
dys:     .res 2
sv:      .res 2             ; smul operands and product
sc:      .res 2
pp:      .res 3
acc:     .res 3
neg:     .res 1
depth:   .res 2
lat:     .res 2
dv:      .res 4             ; div32: dv / ds, quotient in dv+0/1, remainder in dv+2/3
ds:      .res 2
meta:    .res 1             ; per object while cutting
oh:      .res 2
left:    .res 2
top:     .res 2
xc:      .res 2
ou:      .res 1
oey:     .res 1
ofatw:   .res 1
orows:   .res 1
obpr:    .res 1
k0:      .res 1
r0:      .res 1
rvb:     .res 1
tx:      .res 1
ty:      .res 1
row:     .res 1
nspr:    .res 1
ostart:  .res 1
buf:     .res 1             ; the hidden screen: 0 = A, 1 = B
imgp:    .res 2
srcp:    .res 2
any:     .res 1
mk0:     .res 1
mk1:     .res 1
mk2:     .res 1
ocol:    .res 1
sx:      .res 2
nsorted: .res 1
si:      .res 1
full:    .res 1             ; a tile had pixels but all 8 sprites were taken

.segment "BSS"
PERPLO:  .res RAYS          ; each ray's corrected distance (from cast)
PERPHI:  .res RAYS
OV:      .res 16            ; per object: visible, depth, centre x, half wall height
ODLO:    .res 16
ODHI:    .res 16
OCLO:    .res 16
OCHI:    .res 16
OHLO:    .res 16
OHHI:    .res 16
ORDER:   .res 16
MASK:    .res 16            ; per image byte column: the bits of the columns not behind a wall
SHX:     .res 16            ; shadow sprite registers per screen (8 sprites each)
SHY:     .res 16
SHC:     .res 16
SHMSB:   .res 2
SHEN:    .res 2
SHEXP:   .res 2
SCRATCH: .res 64

.segment "CODE"
; ------------------------------------------------------------------ project
project:
    jsr heading
    lda COSLO,x
    sta cs
    lda COSHI,x
    sta cs+1
    lda SINLO,x
    sta sn
    lda SINHI,x
    sta sn+1
    ldx #0
@obj:
    cpx #NOBJ
    bcc :+
    rts
:   stx ob
    lda #0
    sta OV,x
    sec
    lda OBJXLO,x
    sbc px
    sta dxs
    lda OBJXHI,x
    sbc px+1
    sta dxs+1
    sec
    lda OBJYLO,x
    sbc py
    sta dys
    lda OBJYHI,x
    sbc py+1
    sta dys+1

    ; depth = (dx * cos + dy * sin) >> 8
    lda dxs
    ldy dxs+1
    ldx #cs
    jsr smulv
    lda pp
    sta acc
    lda pp+1
    sta acc+1
    lda pp+2
    sta acc+2
    lda dys
    ldy dys+1
    ldx #sn
    jsr smulv
    clc
    lda acc
    adc pp
    lda acc+1
    adc pp+1
    sta depth
    lda acc+2
    adc pp+2
    sta depth+1
    bmi @behind             ; 32 <= depth < FOG_PERP, or the object is behind the player, on top of
    bne :+                  ; it, or in the fog
    lda depth
    cmp #32
    bcc @behind
:   lda depth
    cmp #<FOG_PERP
    lda depth+1
    sbc #>FOG_PERP
    bcc :+
@behind:
    jmp @next

    ; lat = (dy * cos - dx * sin) >> 8
:
    lda dys
    ldy dys+1
    ldx #cs
    jsr smulv
    lda pp
    sta acc
    lda pp+1
    sta acc+1
    lda pp+2
    sta acc+2
    lda dxs
    ldy dxs+1
    ldx #sn
    jsr smulv
    sec
    lda acc
    sbc pp
    lda acc+1
    sbc pp+1
    sta lat
    lda acc+2
    sbc pp+2
    sta lat+1

    lda lat+1               ; neg = lat's sign, lat = |lat|
    sta neg
    bpl :+
    sec
    lda #0
    sbc lat
    sta lat
    lda #0
    sbc lat+1
    sta lat+1
:   lda depth               ; |lat| > 2 * depth: off the screen whatever its size
    asl
    sta ds
    lda depth+1
    rol
    sta ds+1
    lda ds
    cmp lat
    lda ds+1
    sbc lat+1
    bcs :+
@skip:
    jmp @next

    ; r = |lat| * 256 / depth (at most 512), q = ATAN_COL[r] ray columns (8.8) from the centre, negated
    ; for negative lat; centre = 160 + (q >> 6)
:   lda #0
    sta dv
    sta dv+3
    lda lat
    sta dv+1
    lda lat+1
    sta dv+2
    lda depth
    sta ds
    lda depth+1
    sta ds+1
    jsr div32
    lda #<ATLO
    sta tp
    lda #>ATLO
    clc
    adc dv+1
    sta tp+1
    ldy dv
    lda (tp),y
    tax
    lda #<ATHI
    sta tp
    lda #>ATHI
    clc
    adc dv+1
    sta tp+1
    lda (tp),y
    sta dv+1
    stx dv
    bit neg
    bpl @pos
    sec
    lda #0
    sbc dv
    sta dv
    lda #0
    sbc dv+1
    sta dv+1
@pos:
    ldy #6
:   lda dv+1
    cmp #$80
    ror dv+1
    ror dv
    dey
    bne :-
    ldx ob
    clc
    lda dv
    adc #160
    sta OCLO,x
    lda dv+1
    adc #0
    sta OCHI,x

    lda #<SCALE             ; halfH = SCALE / depth
    sta dv
    lda #>SCALE
    sta dv+1
    lda #0
    sta dv+2
    sta dv+3
    jsr div32
    ldx ob
    lda dv
    sta OHLO,x
    lda dv+1
    sta OHHI,x
    lda depth
    sta ODLO,x
    lda depth+1
    sta ODHI,x
    lda #1
    sta OV,x
@next:
    ldx ob
    inx
    jmp @obj

; pp (24 bits, signed) = (A + Y * 256) * the signed 16-bit value at zero page X (|value| <= 256).
smulv:
    sta sv
    sty sv+1
    lda 0,x
    sta sc
    lda 1,x
    sta sc+1
    lda sv+1
    eor sc+1
    sta neg
    lda sv+1
    bpl :+
    sec
    lda #0
    sbc sv
    sta sv
    lda #0
    sbc sv+1
    sta sv+1
:   lda sc+1
    bpl :+
    sec
    lda #0
    sbc sc
    sta sc
    lda #0
    sbc sc+1
    sta sc+1
:   lda sc+1
    beq @mul
    lda #0                  ; |value| = 256: a shift
    sta pp
    lda sv
    sta pp+1
    lda sv+1
    sta pp+2
    jmp @sign
@mul:
    lda sv
    sta m_b
    lda sv+1
    sta m_b+1
    lda sc
    jsr mul8x16
    lda m_r
    sta pp
    lda m_r+1
    sta pp+1
    lda m_r+2
    sta pp+2
@sign:
    bit neg
    bpl :+
    sec
    lda #0
    sbc pp
    sta pp
    lda #0
    sbc pp+1
    sta pp+1
    lda #0
    sbc pp+2
    sta pp+2
:   rts

; dv (32 bits) / ds (16 bits): quotient in dv+0/1, remainder in dv+2/3. The quotient must fit 16 bits.
div32:
    ldx #16
@l: asl dv
    rol dv+1
    rol dv+2
    rol dv+3
    bcs @sub
    lda dv+2
    cmp ds
    lda dv+3
    sbc ds+1
    bcc @no
@sub:
    lda dv+2
    sbc ds
    sta dv+2
    lda dv+3
    sbc ds+1
    sta dv+3
    inc dv
@no:
    dex
    bne @l
    rts

; ------------------------------------------------------------------ cut
; Sorts the visible objects nearest first, then cuts each into the hidden screen's sprites (buf).
cut_all:
    ldx #0                  ; ORDER: the visible objects, insertion-sorted by depth (stable)
    stx nsorted
@gather:
    cpx #NOBJ
    bcs @sorted
    lda OV,x
    beq @nextg
    stx ob
    ldy nsorted             ; shift deeper objects up, then insert (equal depths keep level order)
@ins:
    cpy #0
    beq @put
    lda ORDER-1,y
    tax
    lda ODLO,x
    sta xc
    lda ODHI,x
    sta xc+1
    ldx ob
    lda ODLO,x
    cmp xc
    lda ODHI,x
    sbc xc+1
    bcs @put
    lda ORDER-1,y
    sta ORDER,y
    dey
    jmp @ins
@put:
    lda ob
    sta ORDER,y
    inc nsorted
    ldx ob
@nextg:
    inx
    jmp @gather
@sorted:
    lda #0
    sta nspr
    ldx buf                 ; nothing showing yet
    sta SHMSB,x
    sta SHEXP,x
    ldy #0
@each:
    cpy nsorted
    bcs @done
    sty si
    lda ORDER,y
    jsr cut_one
    ldy si
    iny
    jmp @each
@done:
    ldx buf
    ldy nspr
    lda ENBITS,y
    sta SHEN,x
    lda buf                 ; sprite pointers in the hidden screen
    bne @ptrb
    ldx #7
:   txa
    clc
    adc #SPR_A / 64
    sta SCREEN_A + $3f8,x
    dex
    bpl :-
    rts
@ptrb:
    ldx #7
:   txa
    clc
    adc #SPR_A / 64 + 8
    sta SCREEN_B + $3f8,x
    dex
    bpl :-
    rts

; One object (index in A): its size and image, the column mask, then its tiles. If they don't all
; fit in the sprites left, the object is dropped whole.
cut_one:
    tax
    stx ob
    ldy OBJT,x
    lda TYPE_H,y            ; H = (halfH * height) >> 7
    pha
    lda OHLO,x
    sta m_b
    lda OHHI,x
    sta m_b+1
    pla
    jsr mul8x16
    asl m_r
    rol m_r+1
    rol m_r+2
    ldx ob
    ldy OBJT,x
    lda m_r+2               ; size index: the largest SIZES[k] <= H, capped at the type's largest
    beq :+
    lda TYPE_KMAX,y
    jmp @k
:   lda m_r+1
    cmp SIZES
    bcs :+
    rts                     ; smaller than the smallest size: not drawn
:   ldx #0
@ks:
    cpx #NSIZES - 1
    bcs @kf
    lda SIZES+1,x
    cmp m_r+1
    beq :+
    bcs @kf
:   inx
    jmp @ks
@kf:
    txa
    cmp TYPE_KMAX,y
    bcc @k
    lda TYPE_KMAX,y
@k:
    clc
    adc TYPE_BASE,y
    tax
    stx meta
    lda META_U,x
    sta ou
    lda META_EY,x
    sta oey
    lda META_FATW,x
    sta ofatw
    lda META_ROWS,x
    sta orows
    lda META_BPR,x
    sta obpr
    lda META_IMGLO,x
    sta imgp
    lda META_IMGHI,x
    sta imgp+1
    ldy ob                  ; left = centre - half width; top = horizon + halfH - height
    sec
    lda OCLO,y
    sbc META_HALFW,x
    sta left
    lda OCHI,y
    sbc #0
    sta left+1
    clc
    lda OHLO,y
    adc #HALF_ROWS * 8
    sta top
    lda OHHI,y
    adc #0
    sta top+1
    sec
    lda top
    sbc META_HPX,x
    sta top
    lda top+1
    sbc #0
    sta top+1

    ; k0: whole bytes of columns until the sprite's x >= -24
    lda #0
    sta k0
    lda left
    sta sx
    lda left+1
    sta sx+1
@k0:
    lda sx                  ; sx < -24 (signed)?
    sec
    sbc #<-24
    lda sx+1
    sbc #>-24
    bvc :+
    eor #$80
:   bpl @k0done
    lda ou
    asl
    asl
    clc
    adc sx
    sta sx
    lda sx+1
    adc #0
    sta sx+1
    lda k0
    clc
    adc #4
    sta k0
    jmp @k0
@k0done:

    ; r0 = first row on the view (top >= 0, or ceil(-top / ey)); rvb = rows that end inside it
    lda #0
    sta r0
    lda top+1
    bpl @r0done
    sec
    lda #0
    sbc top
    sta xc
    lda #0
    sbc top+1
    sta xc+1
    lda oey
    cmp #2
    bne :+
    lda xc                  ; (-top + 1) >> 1
    clc
    adc #1
    sta xc
    lda xc+1
    adc #0
    lsr
    ror xc
    sta xc+1
:   lda xc+1
    beq :+
    rts                     ; the whole object is above the view
:   lda xc
    sta r0
@r0done:
    sec                     ; rvb = min(rows, (VIEW_PX - top) / ey), or 0
    lda #<VIEW_PX
    sbc top
    sta xc
    lda #>VIEW_PX
    sbc top+1
    sta xc+1
    bmi @none
    lda oey
    cmp #2
    bne :+
    lsr xc+1
    ror xc
:   lda xc+1
    bne @rmax
    lda xc
    cmp orows
    bcc :+
@rmax:
    lda orows
:   sta rvb
    jmp @mask
@none:
    rts

    ; MASK: for each column fx, visible if 0 <= xc < 320 and depth < the ray's distance
@mask:
    ldx obpr
    lda #0
:   sta MASK-1,x
    dex
    bne :-
    lda ou
    lsr
    clc
    adc left
    sta xc
    lda left+1
    adc #0
    sta xc+1
    ldx #0
@col:
    cpx ofatw
    bcs @tiles
    stx ocol
    lda xc+1                ; 0 <= xc < 320
    bmi @hidden
    beq :+
    cmp #1
    bne @hidden
    lda xc
    cmp #<320
    bcs @hidden
    lda xc+1
:   lsr                     ; ray = xc >> 2
    lda xc
    ror
    lsr
    tay
    ldx ob
    lda ODLO,x              ; depth < PERP[ray]?
    cmp PERPLO,y
    lda ODHI,x
    sbc PERPHI,y
    bcs @hidden
    lda ocol
    and #3
    tay
    lda ocol
    lsr
    lsr
    tax
    lda MASK,x
    ora PIXMASK,y
    sta MASK,x
@hidden:
    clc
    lda xc
    adc ou
    sta xc
    lda xc+1
    adc #0
    sta xc+1
    ldx ocol
    inx
    jmp @col

@tiles:
    lda nspr
    sta ostart
    lda r0
    sta ty
@ty:
    lda ty
    cmp orows
    bcc :+
    rts
:   lda k0
    sta tx
@tx:
    lda tx
    cmp ofatw
    bcc :+
    lda ty
    clc
    adc #21
    sta ty
    jmp @ty
:   lda #0
    sta full
    jsr cut_tile
    lda full
    beq :+
    lda ostart              ; out of sprites: drop the whole object
    sta nspr
    rts
:   lda tx
    clc
    adc #12
    sta tx
    jmp @tx

; cut_tile: tile (tx, ty) of the object into the next sprite block; counted only if any pixel shows. With all
; 8 sprites taken it goes to a scratch block, and a tile with pixels sets `full`.
cut_tile:
    lda nspr
    cmp #8
    bcc :+
    lda #<SCRATCH
    sta @st+1
    lda #>SCRATCH
    sta @st+2
    bne @addr
:   lda buf                 ; block address into the store below
    asl
    asl
    asl
    adc nspr
    tax
    lda BLKLO,x
    sta @st+1
    lda BLKHI,x
    sta @st+2
@addr:
    lda tx                  ; masks of the tile's three byte columns (0 past the image's width)
    lsr
    lsr
    tax
    ldy #0
:   lda #0
    cpx obpr
    bcs :+
    lda MASK,x
:   sta mk0,y
    inx
    iny
    cpy #3
    bne :--
    lda ty                  ; srcp = image + ty * bpr + tx / 4
    sta m_b
    lda #0
    sta m_b+1
    lda obpr
    jsr mul8x16
    lda tx
    lsr
    lsr
    clc
    adc m_r
    sta srcp
    lda m_r+1
    adc #0
    sta srcp+1
    clc
    lda srcp
    adc imgp
    sta srcp
    lda srcp+1
    adc imgp+1
    sta srcp+1
    lda #0
    sta any
    lda ty
    sta row
    ldx #0
@row:
    lda row
    cmp rvb
    bcs @zero
    ldy #0
    lda (srcp),y
    and mk0
    jsr @put
    iny
    lda (srcp),y
    and mk1
    jsr @put
    iny
    lda (srcp),y
    and mk2
    jsr @put
    jmp @adv
@zero:
    lda #0
    jsr @put
    lda #0
    jsr @put
    lda #0
    jsr @put
@adv:
    clc
    lda srcp
    adc obpr
    sta srcp
    bcc :+
    inc srcp+1
:   inc row
    cpx #63
    bcc @row
    lda any
    bne :+
    rts
:   lda nspr
    cmp #8
    bcc :+
    sta full
    rts
:   ldx buf                 ; record it: x = left + tx * u, y = top + ty * ey
    lda buf
    asl
    asl
    asl
    adc nspr
    tay
    lda tx
    sta m_b
    lda #0
    sta m_b+1
    lda ou
    jsr mul8x16
    clc
    lda left
    adc m_r
    sta sx
    lda left+1
    adc m_r+1
    sta sx+1
    clc                     ; VIC x = x + 24
    lda sx
    adc #24
    sta SHX,y
    lda sx+1
    adc #0
    beq :+
    ldx buf
    ldy nspr
    lda SHMSB,x
    ora BITS,y
    sta SHMSB,x
:   lda buf
    asl
    asl
    asl
    adc nspr
    tay
    lda ty
    sta m_b
    lda #0
    sta m_b+1
    lda oey
    jsr mul8x16
    clc
    lda top
    adc m_r
    clc
    adc #50
    sta SHY,y
    ldx ob
    lda OBJT,x
    tax
    lda TYPE_COL,x
    sta SHC,y
    lda oey
    cmp #2
    bne :+
    ldx buf
    ldy nspr
    lda SHEXP,x
    ora BITS,y
    sta SHEXP,x
:   inc nspr
    rts
@put:
@st:
    sta $ffff,x             ; patched: this tile's sprite block
    ora any
    sta any
    inx
    rts

.segment "RODATA"
PIXMASK: .byte $c0, $30, $0c, $03
BITS:    .byte 1, 2, 4, 8, 16, 32, 64, 128
ENBITS:  .byte 0, 1, 3, 7, 15, 31, 63, 127, 255
BLKLO:
.repeat 16, I
    .byte <(SPR_A + I * 64)
.endrepeat
BLKHI:
.repeat 16, I
    .byte >(SPR_A + I * 64)
.endrepeat
