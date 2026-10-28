; APEX C64 kit: what every engine shares. Include it after the engine's own constants (gen.inc) and
; before its code: it makes the BASIC line (10 SYS2061) and starts CODE with a jump to the engine's
; start.
;
;   KIT_INIT irq       machine set-up: RAM in place of BASIC and the KERNAL, no CIA interrupts, the
;                      NMI ignored, the raster IRQ vector at irq; the screen off
;   kit_script         SCRIPT builds: the next tick's input from SCRIPT_DATA ([input, ticks] pairs, the
;                      build's script.inc) into the engine's inp; C set when the script has ended
;   KIT_SCRIPT_START   points kit_script at the script's start
;   kit_park           where a SCRIPT build stops: late frames stop counting, the last frame stays up
;   KIT_LATE           in the IRQ when the next frame isn't ready: counts it in missed (if counting)
;   KIT_TIMER_START    times a frame's work on CIA 1 timer A (from $ffff)
;   KIT_TIMER_MAX      the cycles since KIT_TIMER_START, into maxcyc if the most yet
;   MARK n             PROFILE builds: ends part n of the frame's work (see kit_mark)
;   IRQ_IN, IRQ_OUT    PROFILE builds: at an IRQ's start and before its rti, to count IRQ cycles
;
; The engine defines inp (zero page), and for PROFILE builds calls KIT_PROFILE_FRAME at the start of
; each frame's work; KIT_TIMER_MAX keeps the slowest frame's parts. SCRIPT builds get their script
; (script.inc, from c64/kit/build.js) as SCRIPT_DATA. The tests read missed, maxcyc, prof and (in
; engines that set it) latespr through the label file.

.segment "ZEROPAGE"
sptr:     .res 2            ; SCRIPT builds: the next (input, ticks) pair
.ifdef PROFILE
kit_jv:   .res 2
.endif

.segment "BSS"              ; (the engine's memory map needs a BSS segment)
scount:   .res 1            ; SCRIPT builds: the ticks of this pair done
counting: .res 1            ; 1 while late frames count
missed:   .res 2            ; frames shown twice because the next wasn't ready
maxcyc:   .res 2            ; the most cycles a frame's work took
kit_t0:   .res 1
kit_t1:   .res 1
.ifdef PROFILE
plast:    .res 2            ; the time at the last mark
ient:     .res 2            ; the time an IRQ began
irqc:     .res 2            ; this frame's IRQ cycles
nticks:   .res 2            ; frames so far
; per part n, 16-bit: the slowest frame's (prof) and this frame's (pcur). Parts 0-12 are the
; engine's MARKs; 13 the IRQs' cycles; 14 the slowest frame's number.
prof:     .res 32
pcur:     .res 32
.endif

.macro KIT_INIT irq
    sei
    lda #$35                ; RAM in place of BASIC and the KERNAL; I/O stays
    sta $01
    lda #$7f                ; no CIA interrupts
    sta $dc0d
    sta $dd0d
    lda $dc0d
    lda $dd0d
    lda #<kit_nmi
    sta $fffa
    lda #>kit_nmi
    sta $fffb
    lda #<irq
    sta $fffe
    lda #>irq
    sta $ffff
    lda #$0b                ; screen off while setting up
    sta $d011
    lda #$ff                ; CIA 1 timer A's latch, for timing frames
    sta $dc04
    sta $dc05
    lda #0                  ; zero page from $02 clear, so nothing starts from what was there
    ldx #2
:   sta $00,x
    inx
    bne :-
    sta counting
    sta missed
    sta missed+1
    sta maxcyc
    sta maxcyc+1
    sta scount
.ifdef PROFILE
    sta nticks
    sta nticks+1
    ldx #31
:   sta prof,x
    dex
    bpl :-
.endif
.endmacro

.macro KIT_SCRIPT_START
.ifdef SCRIPT
    lda #<SCRIPT_DATA
    sta sptr
    lda #>SCRIPT_DATA
    sta sptr+1
.endif
.endmacro

.macro KIT_LATE
    lda counting            ; (unnamed labels only, so the cheap labels around it keep their scope)
    beq :+
    inc missed
    bne :+
    inc missed+1
:
.endmacro

.macro KIT_TIMER_START
    lda #%00010001          ; force the latch in, and run
    sta $dc0e
.endmacro

.macro KIT_TIMER_MAX
    jsr kit_timer_max
.endmacro

.macro MARK n
.ifdef PROFILE
    jsr kit_mark
    .byte n
.endif
.endmacro

.macro KIT_PROFILE_FRAME
.ifdef PROFILE
    lda #0
    sta plast
    sta plast+1
    sta irqc
    sta irqc+1
    inc nticks
    bne :+
    inc nticks+1
:
.endif
.endmacro

.macro IRQ_IN
.ifdef PROFILE
    lda $dc04
    sta ient
    lda $dc05
    sta ient+1
.endif
.endmacro

.macro IRQ_OUT
.ifdef PROFILE
    sec
    lda ient
    sbc $dc04
    sta ient
    lda ient+1
    sbc $dc05
    sta ient+1
    lda ient
    clc
    adc irqc
    sta irqc
    lda ient+1
    adc irqc+1
    sta irqc+1
.endif
.endmacro

.segment "LOADADDR"
    .word $0801
.segment "EXEHDR"           ; 10 SYS2061, which lands on the jmp start
    .word @next, 10
    .byte $9e, "2061", 0
@next:
    .word 0
.segment "CODE"
    jmp start
kit_nmi:
    rti

; SCRIPT builds stop here when the script ends; the last frame stays on the screen.
kit_park:
    lda #0
    sta counting
script_park:
    jmp script_park

.ifdef SCRIPT
.segment "RODATA"
SCRIPT_DATA:
.include "script.inc"
.segment "CODE"
kit_script:
    ldy #1                  ; input sptr[0] for sptr[1] ticks, pairs until a 0 count
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
.endif

; The cycles since KIT_TIMER_START into maxcyc, if the most yet (the timer stops). With PROFILE, a
; new slowest frame keeps its parts in prof. Returns them in kit_t0/kit_t1.
kit_timer_max:
    lda #0
    sta $dc0e
    lda #$ff
    sec
    sbc $dc04
    sta kit_t0
    lda #$ff
    sbc $dc05
    sta kit_t1
    lda kit_t0
    cmp maxcyc
    lda kit_t1
    sbc maxcyc+1
    bcc @done
    lda kit_t0
    sta maxcyc
    lda kit_t1
    sta maxcyc+1
.if .defined(PROFILE) .and .not .defined(KIT_OWN_SLOWEST)
    jsr kit_keep_prof
.endif
@done:
    rts

.ifdef PROFILE
; This frame's parts (and its IRQ cycles and number) as the slowest frame's. kit_timer_max calls it,
; unless the engine defines KIT_OWN_SLOWEST and calls it itself, by its own measure.
kit_keep_prof:
    lda irqc
    sta pcur+26
    lda irqc+1
    sta pcur+27
    lda nticks
    sta pcur+28
    lda nticks+1
    sta pcur+29
    ldx #31
:   lda pcur,x
    sta prof,x
    dex
    bpl :-
    rts
.endif

.ifdef PROFILE
; The cycles since the last mark into pcur[n] (n: the byte after the jsr).
kit_mark:
    pla
    sta kit_jv
    pla
    sta kit_jv+1
@read:
    ldy $dc05               ; elapsed = $ffff - timer (read again if the high byte moved)
    ldx $dc04
    cpy $dc05
    bne @read
    tya
    eor #$ff
    tay
    txa
    eor #$ff
    tax
    sec
    txa
    sbc plast
    sta kit_t0
    tya
    sbc plast+1
    sta kit_t1
    stx plast
    sty plast+1
    ldy #1
    lda (kit_jv),y
    asl
    tax
    lda kit_t0
    sta pcur,x
    lda kit_t1
    sta pcur+1,x
    lda kit_jv
    clc
    adc #2
    sta kit_jv
    bcc :+
    inc kit_jv+1
:   jmp (kit_jv)
.endif
