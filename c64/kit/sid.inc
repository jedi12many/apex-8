; APEX C64 kit: the SID driver. Music on three voices and sound effects on the third, following the
; reference (core/sound.js) step for step, so it sets exactly the same SID registers every tick.
; Include it after kit.inc, with the song's tables (sound.inc, from c64/kit/sidgen.js) on the
; include path.
;
;   snd_init        silence, and the song from its start
;
; Effects play on voice SFX_VOICE (the song's effectsVoice); the filter's cutoff sweeps by a table.
;   snd_fx          starts effect A (SFX_<NAME> in sound.inc), if nothing is playing or nothing with a
;                   higher priority. Keeps X and Y
;   snd_tick        one tick: the next row, each voice, the effect, into the register image snd_img.
;                   SCRIPT builds also fold the image into the checksum snd_sum, as the tests do
;                   (unless SND_NOSUM: timing builds leave it out, as the game itself does)
;   snd_out         the register image to the SID ($D400-$D418): once a frame, at a steady time

.include "sound.inc"

.segment "BSS"
snd_img:   .res 25          ; the SID's registers, as the next snd_out writes them
snd_timer: .res 1           ; ticks left in this row
snd_row:   .res 1
snd_pos:   .res 1           ; the place in the order
v_ins:     .res 3           ; per voice: its instrument ($ff: none yet), note, gate phase (0 restart,
v_note:    .res 3           ; 1 on, 2 released), ticks since the note, place in its arpeggio, pulse
v_phase:   .res 3           ; width
v_age:     .res 3
v_arp:     .res 3
v_pwl:     .res 3
v_pwh:     .res 3
v_tpos:    .res 3           ; per voice: the step in its instrument's table
snd_ft:    .res 1           ; the filter sweep's tick
snd_route: .res 1           ; this tick's voices through the filter
sfx:       .res 1           ; the effect playing ($ff: none), its step, its ticks left in the step
sfx_step:  .res 1           ; and its frequency
sfx_left:  .res 1
sfx_fl:    .res 1
sfx_fh:    .res 1
snd_sum:   .res 2           ; SCRIPT builds: the checksum of every tick's image
snd_t:     .res 1
snd_b:     .res 1           ; snd_voice: the voice's registers in the image, and its values
snd_w:     .res 1
snd_ad:    .res 1
snd_sr:    .res 1
snd_fl:    .res 1

.segment "ZEROPAGE"
snd_pp:    .res 2           ; a pattern

.segment "CODE"
snd_init:
    lda #0
    ldx #24
:   sta snd_img,x
    dex
    bpl :-
    sta snd_timer
    sta snd_row
    sta snd_pos
    sta snd_sum
    sta snd_sum+1
    sta snd_ft
    ldx #2
:   lda #$ff
    sta v_ins,x
    lda #2
    sta v_phase,x
    lda #0
    sta v_note,x
    sta v_tpos,x
    sta v_age,x
    sta v_arp,x
    sta v_pwl,x
    sta v_pwh,x
    dex
    bpl :-
    lda #$ff
    sta sfx
    rts

snd_fx:
    stx snd_t
    ldx sfx
    bmi @start
    pha
    tax
    lda SFX_PRI,x           ; (A's priority)
    ldx sfx
    cmp SFX_PRI,x
    pla
    bcc @done               ; lower than the one playing
@start:
    sta sfx
    tax
    lda SFX_FIRST,x
    sta sfx_step
    tax
    lda ST_TICKS,x
    sta sfx_left
    lda ST_FL,x
    sta sfx_fl
    lda ST_FH,x
    sta sfx_fh
@done:
    ldx snd_t
    rts

snd_tick:
    ; a new row on every voice
    lda snd_timer
    beq :+
    jmp @voices
:   ldx #2
@row:
    txa                     ; the voice's pattern at this place in the order
    clc
    adc snd_pos
    adc snd_pos
    adc snd_pos
    tay
    lda SND_ORDER,y
    tay
    lda SND_PAT_LO,y
    sta snd_pp
    lda SND_PAT_HI,y
    sta snd_pp+1
    lda snd_row
    asl
    tay
    lda (snd_pp),y          ; the op
    beq @nextv
    cmp #1
    bne @note
    lda #2                  ; release
    sta v_phase,x
    jmp @nextv
@note:
    sec
    sbc #2
    sta snd_t               ; the note
    iny
    lda (snd_pp),y          ; and its instrument, or $ff for the voice's last
    bmi :+
    sta v_ins,x
:   lda v_ins,x
    bmi @nextv              ; (none yet: nothing to play)
    tay
    lda snd_t
    sta v_note,x
    lda #0
    sta v_phase,x
    sta v_age,x
    sta v_arp,x
    sta v_tpos,x
    lda INS_PWL,y
    sta v_pwl,x
    lda INS_PWH,y
    sta v_pwh,x
@nextv:
    dex
    bpl @row
    inc snd_row
    lda snd_row
    cmp #32
    bne :+
    lda #0
    sta snd_row
    inc snd_pos
    lda snd_pos
    cmp #SND_ORDER_LEN
    bne :+
    lda #0
    sta snd_pos
:   lda #SND_SPEED
    sta snd_timer
@voices:
    dec snd_timer
    lda #0
    sta snd_route
    ldx #2                  ; each voice's registers, then its state moves on
:   jsr snd_voice
    dex
    bpl :-
    ; an effect on voice 3
    ldx sfx
    bmi @fixed
    ldx sfx_step
    lda sfx_fl
    sta snd_img+SFX_BASE
    lda sfx_fh
    sta snd_img+SFX_BASE+1
    lda ST_PWL,x
    sta snd_img+SFX_BASE+2
    lda ST_PWH,x
    sta snd_img+SFX_BASE+3
    lda ST_CTRL,x
    sta snd_img+SFX_BASE+4
    lda ST_AD,x
    sta snd_img+SFX_BASE+5
    lda ST_SR,x
    sta snd_img+SFX_BASE+6
    lda sfx_fl              ; it slides
    clc
    adc ST_SL,x
    sta sfx_fl
    lda sfx_fh
    adc ST_SH,x
    sta sfx_fh
    dec sfx_left
    bne @fixed
    inx                     ; the next step, or the end
    stx sfx_step
    ldy sfx
    txa
    cmp SFX_END,y
    bne :+
    lda #$ff
    sta sfx
    bne @fixed
:   lda ST_TICKS,x
    sta sfx_left
    lda ST_FL,x
    sta sfx_fl
    lda ST_FH,x
    sta sfx_fh
@fixed:
    ldx snd_ft              ; the filter: its cutoff this tick, its voices, its mode; full volume
    lda SND_CUT_LO,x
    sta snd_img+21
    lda SND_CUT_HI,x
    sta snd_img+22
    inx
    cpx #<SND_FPERIOD
    bne :+
    ldx #0
:   stx snd_ft
    lda #SND_RES << 4
    ora snd_route
    sta snd_img+23
    lda #SND_FMODE | $0f
    sta snd_img+24
.if .defined(SCRIPT) .and .not .defined(SND_NOSUM)
    ldx #0                  ; the checksum: rotate left, add
:   lda snd_sum+1
    asl
    rol snd_sum
    rol snd_sum+1
    lda snd_sum
    clc
    adc snd_img,x
    sta snd_sum
    bcc :+
    inc snd_sum+1
:   inx
    cpx #25
    bne :--
.endif
    rts

; Voice X's registers into the image (none with no instrument yet; none for voice 3 under an
; effect, which sets them), then its state moves on.
snd_voice:
    ldy V_BASE,x
    sty snd_b
    lda v_ins,x
    bmi @silent
    cpx #SFX_VOICE
    bne @emit
    lda sfx                 ; (under an effect, which sets them)
    bmi @emit
    ldy v_ins,x
    jmp @state
@silent:
    lda #0                  ; no instrument yet: nothing
    sta snd_img,y
    sta snd_img+1,y
    sta snd_img+2,y
    sta snd_img+3,y
    sta snd_img+4,y
    sta snd_img+5,y
    sta snd_img+6,y
    rts
@emit:
    ldy v_ins,x
    lda INS_AD,y
    sta snd_ad
    lda INS_SR,y
    sta snd_sr
    lda INS_FILT,y          ; through the filter?
    beq :+
    lda V_BIT,x
    ora snd_route
    sta snd_route
:   lda INS_TLEN,y
    beq @arp
    lda v_tpos,x            ; a table: its step (the last, once past it)
    cmp INS_TLEN,y
    bcc :+
    lda INS_TLEN,y
    sbc #1
:   clc
    adc INS_TAB,y
    tay
    lda SND_TW,y
    sta snd_w
    lda SND_TN,y
    bmi :+
    eor #$40                ; the note + n (n: 7 bits, signed)
    sec
    sbc #$40
    clc
    adc v_note,x
    jmp @note
:   and #$7f                ; a fixed note
    jmp @note
@arp:
    lda INS_WAVE,y
    sta snd_w
    lda INS_ARP,y           ; note + arpeggio
    clc
    adc v_arp,x
    tay
    lda SND_ARP,y
    clc
    adc v_note,x
@note:
    cmp #$c0                ; 0 to 95 (below 0: 0)
    bcc :+
    lda #0
:   cmp #96
    bcc :+
    lda #95
:   tay
    lda v_phase,x           ; the control register: the gate bit only while on
    cmp #1
    bne :+
    inc snd_w
:
    lda SND_FREQ_LO,y
    sta snd_fl
    lda SND_FREQ_HI,y
    ldy snd_b
    sta snd_img+1,y
    lda snd_fl
    sta snd_img,y
    lda v_pwl,x
    sta snd_img+2,y
    lda v_pwh,x
    sta snd_img+3,y
    lda snd_w
    sta snd_img+4,y
    lda snd_ad
    sta snd_img+5,y
    lda snd_sr
    sta snd_img+6,y
    ldy v_ins,x
@state:
    lda v_phase,x           ; the table moves on once the gate is on
    beq :+
    lda v_tpos,x
    cmp #255
    beq :+
    inc v_tpos,x
:   lda v_phase,x           ; restart -> on; on -> released once the gate length is reached
    bne :+
    lda #1
    sta v_phase,x
    jmp @age
:   cmp #1
    bne @age
    lda INS_GATE,y
    beq @age
    lda v_age,x
    clc
    adc #1
    bcs :+                  ; (age + 1 = 256)
    cmp INS_GATE,y
    bcc @age
:   lda #2
    sta v_phase,x
@age:
    lda v_age,x
    cmp #255
    beq :+
    inc v_age,x
:   inc v_arp,x             ; the arpeggio, round and round
    lda v_arp,x
    cmp INS_ARPLEN,y
    bne :+
    lda #0
    sta v_arp,x
:   lda v_pwl,x             ; the pulse width sweeps (12 bits)
    clc
    adc INS_PWSL,y
    sta v_pwl,x
    lda v_pwh,x
    adc INS_PWSH,y
    and #$0f
    sta v_pwh,x
    rts

snd_out:
.repeat 25, I
    lda snd_img+I
    sta $d400+I
.endrepeat
    rts

.segment "RODATA"
V_BASE: .byte 0, 7, 14
V_BIT:  .byte 1, 2, 4
.segment "CODE"
