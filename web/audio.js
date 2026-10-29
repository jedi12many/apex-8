/*
 * APEX audio for the browser pages: a game's sound, as the C64 makes it. Each tick the page tells it
 * what the game did (the effects to start, whether the music plays); core/sound.js turns that into the
 * SID's 25 registers, exactly as the C64's driver writes them, and core/sid.js plays them, in an
 * AudioWorklet (built from APEXSID.source), or a ScriptProcessor where worklets can't run (pages opened
 * from a file).
 *
 * Browsers start sound only after the player does something, so start() is called from the page's
 * first key press, click or touch; until then the song still moves on, silently, so it is where it
 * would be. M (the page's) mutes and unmutes.
 *
 *   const audio = APEXAUDIO.create(songDefinition)
 *   audio.tick(['shot', ...], musicOn)   once a game tick (50 a second), the effects by name
 *   audio.start()                         from a user gesture; audio.toggleMute()
 *
 * Works in the browser (global APEXAUDIO, needing APEXSOUND and APEXSID).
 */
(function (root, factory) {
  root.APEXAUDIO = factory(root.APEXSOUND, root.APEXSID);
})(typeof self !== 'undefined' ? self : this, function (S, SID) {
  'use strict';

  const FPS = 50;
  // The worklet: a queue of register frames, each played for 1/50 s of samples. A few frames of slack
  // absorb the page's uneven ticks; too many (the page ran ahead) and the oldest go; none for half a second
  // (the page stopped, say hidden) and the chip falls silent rather than hold a note.
  const WORKLET = `
const APEXSID = ${SID.source};
class ApexSid extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sid = APEXSID.create(sampleRate);
    this.queue = [];
    this.left = 0;
    this.starved = 0;
    this.port.onmessage = e => { this.queue.push(e.data); if (this.queue.length > 8) this.queue.splice(0, this.queue.length - 3); };
  }
  process(inputs, outputs) {
    const out = outputs[0][0];
    out.fill(0);
    for (let i = 0; i < out.length;) {
      if (this.left <= 0) {
        if (this.queue.length) { this.sid.write(this.queue.shift()); this.starved = 0; }
        else if (++this.starved === 25) this.sid.write(new Array(25).fill(0)); // the page stopped: silence
        this.left += sampleRate / ${FPS};
      }
      const n = Math.min(out.length - i, Math.ceil(this.left));
      this.sid.render(out, i, n);
      i += n;
      this.left -= n;
    }
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);
    return true;
  }
}
registerProcessor('apex-sid', ApexSid);
`;

  function create(def) {
    const c = S.compile(def), p = S.player(c);
    let ctx = null, send = null, muted = false;

    // The fallback: the same queue and chip on the page's own thread.
    function scriptProcessor() {
      const sid = SID.create(ctx.sampleRate), queue = [];
      let left = 0, starved = 0;
      const node = ctx.createScriptProcessor(2048, 0, 1);
      node.onaudioprocess = e => {
        const out = e.outputBuffer.getChannelData(0);
        out.fill(0);
        for (let i = 0; i < out.length;) {
          if (left <= 0) {
            if (queue.length) { sid.write(queue.shift()); starved = 0; } else if (++starved === 25) sid.write(new Array(25).fill(0));
            left += ctx.sampleRate / FPS;
          }
          const n = Math.min(out.length - i, Math.ceil(left));
          sid.render(out, i, n);
          i += n;
          left -= n;
        }
      };
      node.connect(ctx.destination);
      send = R => { queue.push(R); if (queue.length > 12) queue.splice(0, queue.length - 5); };
    }

    function start() {
      if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
      const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Ctx) return;
      ctx = new Ctx();
      if (ctx.audioWorklet && globalThis.isSecureContext) {
        const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
        ctx.audioWorklet.addModule(url).then(() => {
          const node = new AudioWorkletNode(ctx, 'apex-sid', { numberOfInputs: 0, outputChannelCount: [2] });
          node.connect(ctx.destination);
          send = R => node.port.postMessage(R);
        }).catch(scriptProcessor);
      } else scriptProcessor();
    }

    function tick(effects = [], music = true) {
      const ids = effects.map(n => c.effNames.indexOf(n)).filter(k => k >= 0);
      const R = S.tick(c, p, ids, music);
      if (!send) return;
      if (muted) R[24] &= 0xf0; // the volume to 0
      send(Array.from(R));
    }

    return { start, tick, toggleMute: () => { muted = !muted; return muted; }, get muted() { return muted; } };
  }

  return { create };
});
