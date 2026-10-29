; APEX C64 kit: the REU (a RAM Expansion Unit: a C64 Ultimate's, or a 1700/1750/1764), for copying
; memory by DMA: a byte a cycle with the CPU stopped, where the CPU's fastest copy (unrolled) takes 8.
; A copy within the C64 goes out to the REU and back, so it costs 2 cycles a byte. Include it after
; kit.inc.
;
;   reu_detect   reu = 1 if there is an REU (its address registers keep what is written to them;
;                without one, $DF00-$DFFF reads whatever is on the bus)
;   reu_copy     copies reu_len bytes from reu_from to reu_to through the REU's first bytes. The CPU
;                (and its interrupts) wait for it: call it where no interrupt is due for that long.
;                Keeps nothing

REU_CMD  = $df01             ; bit 7 go, bit 4 at once (not on a write to $FF00), bits 0-1: 0 stash
REU_C64  = $df02             ; (C64 to REU), 1 fetch (REU to C64)
REU_ADDR = $df04
REU_LEN  = $df07
REU_CTRL = $df0a             ; 0: both addresses count up

.segment "BSS"
reu:      .res 1
reu_from: .res 2
reu_to:   .res 2
reu_len:  .res 2

.segment "CODE"
reu_detect:
    lda #0
    sta reu
    ldx #1                  ; two patterns, each read back from the C64 and REU address registers
@try:
    lda REU_PATTERN,x
    sta REU_C64
    eor #$ff
    sta REU_C64+1
    eor #$5a
    sta REU_ADDR
    cmp REU_ADDR
    bne @none
    eor #$5a
    cmp REU_C64+1
    bne @none
    eor #$ff
    cmp REU_C64
    bne @none
    dex
    bpl @try
    inc reu
@none:
    rts

reu_copy:
    lda #0
    sta REU_CTRL
    ldx #$90                ; stash: from reu_from out to the REU, then fetch: back to reu_to
    lda reu_from
    ldy reu_from+1
@go:
    sta REU_C64
    sty REU_C64+1
    lda #0
    sta REU_ADDR
    sta REU_ADDR+1
    sta REU_ADDR+2
    lda reu_len
    sta REU_LEN
    lda reu_len+1
    sta REU_LEN+1
    stx REU_CMD             ; (the transfer runs here)
    cpx #$91
    beq @done
    ldx #$91
    lda reu_to
    ldy reu_to+1
    jmp @go
@done:
    rts

.segment "RODATA"
REU_PATTERN: .byte $a5, $3c
.segment "CODE"
