/*
 * APEX story mode: the reference for scenes told over a picture, with text and choices. Integer maths
 * only, so a 6502 port that follows the same steps shows exactly the same thing every frame.
 *
 * A story (stories/<name>.js) is:
 *   { name, song, sounds: { type, more, move, choose } (effects of the song to play, any may be left
 *     out), typeSpeed (ticks a letter, default 2), pictures: { id: picture }, start: scene id,
 *     scenes: { id: scene } }
 * A picture is { file, crop, cells: [cw, ch], ... } (c64/story/pictures.js converts it), or a run of
 * frames for zooming and turning: { file, frames: { count, from, to } }, from and to each { x, y, w,
 * angle }: the image's point at the window's middle, the image's width the window shows, and the
 * angle it is turned by (degrees, clockwise), each frame a step between them. Frames are window-sized
 * (40 x 15 cells), and listed as pictures id#0, id#1, ... (pictureList).
 * A scene is:
 *   { picture, pan: { from: [x, y], to: [x, y], ticks }, or steps: { frames, every, reverse },
 *     speaker, text, then one of: choices: [{ text, go, set, if, unless }], next: scene id, end: true }
 * steps play a run of frames, one every `every` ticks (at least STEP_GAP), backwards if reverse: a zoom
 * played backwards is a pull-back.
 *
 * The picture shows in a window 304 pixels wide (the 38-column screen) and 113 lines high; pan
 * positions are the picture's pixel (hires x, line) at the window's top-left corner, x counted from
 * the screen's left edge (the first 7 pixels are under the border). Below the window is the text area:
 * the speaker's name, the text 4 lines at a time (each up to LINE letters), and up to 4 choices.
 * Choices whose `if` flag isn't set, or whose `unless` flag is, aren't shown; `set` sets a flag.
 *
 * compile(story, sizes) checks a story and turns it into plain arrays (sizes: each picture's [cw, ch]).
 * start(c) and play(c, s, bits) run it one 50 Hz tick at a time; bits: 1 up, 2 down, 16 fire (a press
 * counts once). Each tick, in order:
 *   1. a scene change in progress: the window stays dark for BLANK ticks while the next picture is
 *      readied, and nothing else happens
 *   2. the pan moves by its step (8.8 pixels) until its ticks are done
 *   3. the text: a letter appears every typeSpeed ticks (fire shows the rest of the page). A full page
 *      waits for fire: the next page; or, on the last page, the choices (up and down move the choice,
 *      fire takes it), the next scene, or the start again at the end
 * s.events lists what happened, for the sound: type, more, move, choose.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.APEXSTORY = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LINE = 38, LINES = 4, CHOICES = 4, NAME = 38, BLANK = 16;
  const VIEW_W = 304, VIEW_H = 113;           // the window: 38 columns, lines 55-167 of the frame
  const FLAGS = 16;
  const GAP = 8, STEP_GAP = 3;
  const FRAME_CELLS = [40, 15];
  // A story's pictures, frames expanded: [{ id, picture (the story's), group, k }] (k: the frame, or -1).
  function pictureList(story) {
    return Object.entries(story.pictures).flatMap(([id, p]) => (p.frames
      ? Array.from({ length: p.frames.count }, (_, k) => ({ id: `${id}#${k}`, picture: p, group: id, k }))
      : [{ id, picture: p, group: id, k: -1 }]));
  }
  // The window's first cell for a pan position (8.8 pixels): column ceil(x / 8), row floor(y / 8).
  const cellOf = (x8, y8) => `${((x8 >> 8) + 7) >> 3},${(y8 >> 8) >> 3}`;
  // The letters the text can use: APEXSCII's text block ($00-$3F, as screen codes).
  const LETTERS = '@ABCDEFGHIJKLMNOPQRSTUVWXYZ[£]^_ !"#$%&\'()*+,-./0123456789:;<=>?';
  const code = ch => { const k = LETTERS.indexOf(ch); if (k < 0) throw new Error(`story: no letter for '${ch}'`); return k; };

  // Words wrapped into lines of at most n letters; \n starts a new line.
  function wrap(text, n) {
    const lines = [];
    for (const para of text.toUpperCase().split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/).filter(Boolean)) {
        if (word.length > n) throw new Error(`story: "${word}" is longer than a line`);
        if (line && line.length + 1 + word.length > n) { lines.push(line); line = word; } else line = line ? line + ' ' + word : word;
      }
      lines.push(line);
    }
    return lines;
  }

  function compile(story, sizes) {
    const ids = Object.keys(story.scenes), list = pictureList(story), picIds = list.map(p => p.id);
    const flags = [];
    const flag = name => { if (name === undefined) return -1; let k = flags.indexOf(name); if (k < 0) { k = flags.length; flags.push(name); } if (k >= FLAGS) throw new Error(`story: more than ${FLAGS} flags`); return k; };
    const scene = id => { const k = ids.indexOf(id); if (k < 0) throw new Error(`story: no scene "${id}"`); return k; };
    const scenes = ids.map(id => {
      const sc = story.scenes[id], where = `story: scene "${id}"`;
      let steps = null;
      if (sc.steps) {
        const st = sc.steps, base = picIds.indexOf(`${st.frames}#0`);
        if (base < 0) throw new Error(`${where}: no frames "${st.frames}"`);
        if (!(st.every >= STEP_GAP)) throw new Error(`${where}: steps must be at least ${STEP_GAP} ticks apart`);
        steps = { base, count: story.pictures[st.frames].frames.count, every: st.every, reverse: !!st.reverse };
      }
      const pic = steps ? steps.base + (steps.reverse ? steps.count - 1 : 0) : picIds.indexOf(sc.picture);
      if (pic < 0) throw new Error(`${where}: no picture "${sc.picture}"`);
      if (steps && sc.pan) throw new Error(`${where}: steps don't pan`);
      const [cw, ch] = sizes[pic], maxX = cw * 8 - 320, maxY = ch * 8 - VIEW_H;
      const pan = sc.pan || { from: [0, 0], to: [0, 0], ticks: 0 };
      for (const [x, y] of [pan.from, pan.to]) {
        if (x < 0 || x > maxX || y < 0 || y > maxY) throw new Error(`${where}: the pan must stay within 0-${maxX} across and 0-${maxY} down`);
      }
      const ticks = steps ? (steps.count - 1) * steps.every : pan.ticks || 0;
      const step = d => (ticks ? Math.trunc((d * 256) / ticks) : 0);
      const dx = steps ? 0 : step(pan.to[0] - pan.from[0]), dy = steps ? 0 : step(pan.to[1] - pan.from[1]);
      if (Math.abs(dx) > 256 || Math.abs(dy) > 256) throw new Error(`${where}: the pan is faster than a pixel a tick`);
      // The window's cell changes when the pan crosses a cell; each needs the picture copied again,
      // which takes a C64 about 6 frames, so changes must be GAP ticks apart (or in the same tick).
      let last = -GAP, cell = cellOf(pan.from[0] * 256, pan.from[1] * 256);
      for (let t = 1, x = pan.from[0] * 256, y = pan.from[1] * 256; t <= ticks; t++) {
        x += dx; y += dy;
        const now = cellOf(x, y);
        if (now === cell) continue;
        if (t - last < GAP) throw new Error(`${where}: the pan crosses cells at ticks ${last} and ${t}, under ${GAP} apart; change its ends or ticks a little`);
        last = t; cell = now;
      }
      const lines = wrap(sc.text || '', LINE);
      const pages = [];
      for (let k = 0; k < lines.length; k += LINES) pages.push(lines.slice(k, k + LINES).map(l => Array.from(l, code)));
      const speaker = Array.from((sc.speaker || '').toUpperCase(), code);
      if (speaker.length > NAME) throw new Error(`${where}: the speaker's name is too long`);
      const choices = (sc.choices || []).map(c => {
        const text = Array.from(c.text.toUpperCase(), code);
        if (text.length > LINE - 2) throw new Error(`${where}: the choice "${c.text}" is longer than ${LINE - 2} letters`);
        return { text, go: scene(c.go), set: flag(c.set), if: flag(c.if), unless: flag(c.unless) };
      });
      if (choices.length > CHOICES) throw new Error(`${where}: more than ${CHOICES} choices`);
      if (!choices.length && !sc.end && sc.next === undefined) throw new Error(`${where}: needs choices, next or end`);
      return {
        id, picture: pic, steps, x0: pan.from[0], y0: pan.from[1], dx, dy, ticks, speaker, pages, choices,
        next: choices.length || sc.end ? -1 : scene(sc.next), set: flag(sc.set),
      };
    });
    return { name: story.name, typeSpeed: story.typeSpeed || 2, scenes, flags, start: scene(story.start), pictures: picIds,
      frames: list.map(p => p.k >= 0), sounds: story.sounds || {} };
  }

  // The choices a scene shows with these flags, as indexes into its choices.
  function shownChoices(sc, flags) {
    const on = k => k >= 0 && (flags >> k) & 1;
    return sc.choices.map((c, i) => i).filter(i => { const c = sc.choices[i]; return (c.if < 0 || on(c.if)) && !on(c.unless); });
  }
  const pageLength = page => page.reduce((n, l) => n + l.length, 0);

  // A story's state: the scene, its page, the letters shown, what it waits for, the choice, the pan
  // (8.8 pixels) and its tick, the flags, the button held, a scene change's dark ticks, and the clock.
  function start(c) {
    const s = { scene: -1, page: 0, shown: 0, wait: 0, phase: 'type', sel: 0, x8: 0, y8: 0, t: 0, flags: 0, held: 0, blank: 0, clock: 0, events: [] };
    enter(c, s, c.start, true);
    return s;
  }

  // The picture the window shows: the scene's, or the frame its steps are at.
  function picture(c, s) {
    const sc = c.scenes[s.scene], st = sc.steps;
    if (!st) return sc.picture;
    const f = Math.min(st.count - 1, Math.floor(s.t / st.every));
    return st.base + (st.reverse ? st.count - 1 - f : f);
  }

  function enter(c, s, k, first = false) {
    const sc = c.scenes[k], oldPic = first ? -1 : picture(c, s), old = { x8: s.x8, y8: s.y8 };
    s.scene = k;
    s.page = 0; s.shown = 0; s.wait = 0; s.sel = 0; s.t = 0;
    s.phase = 'type';
    s.x8 = sc.x0 * 256; s.y8 = sc.y0 * 256;
    if (sc.set >= 0) s.flags |= 1 << sc.set;
    // A new picture, or a jump to another cell of this one: dark while the window is readied.
    if (first || picture(c, s) !== oldPic || cellOf(s.x8, s.y8) !== cellOf(old.x8, old.y8)) s.blank = BLANK;
  }

  function play(c, s, bits) {
    const events = (s.events = []), press = bits & ~s.held;
    s.held = bits;
    s.clock = (s.clock + 1) & 0xff;
    if (s.blank) { s.blank--; return s; }
    const sc = c.scenes[s.scene];
    if (s.t < sc.ticks) { s.x8 += sc.dx; s.y8 += sc.dy; s.t++; }

    const page = sc.pages[s.page] || [], len = pageLength(page);
    if (s.phase === 'type') {
      if (press & 16 && s.shown) { s.shown = len; s.wait = 0; }
      else if (s.shown < len && ++s.wait === c.typeSpeed) { s.wait = 0; s.shown++; events.push('type'); }
      if (s.shown === len) s.phase = s.page < sc.pages.length - 1 ? 'more' : sc.choices.length ? 'choose' : 'done';
      return s;
    }
    if (s.phase === 'more') {
      if (press & 16) { s.page++; s.shown = 0; s.wait = 0; s.phase = 'type'; events.push('more'); }
      return s;
    }
    if (s.phase === 'choose') {
      const list = shownChoices(sc, s.flags);
      if (press & 1 && s.sel > 0) { s.sel--; events.push('move'); }
      else if (press & 2 && s.sel < list.length - 1) { s.sel++; events.push('move'); }
      else if (press & 16 && list.length) {
        const ch = sc.choices[list[s.sel]];
        if (ch.set >= 0) s.flags |= 1 << ch.set;
        events.push('choose');
        enter(c, s, ch.go);
      }
      return s;
    }
    if (press & 16) { events.push('more'); enter(c, s, sc.next >= 0 ? sc.next : c.start); }
    return s;
  }

  // Where the pan is: the picture's pixel at the window's top-left.
  const pan = s => ({ x: s.x8 >> 8, y: s.y8 >> 8 });

  return { LINE, LINES, CHOICES, NAME, BLANK, GAP, STEP_GAP, FRAME_CELLS, pictureList, picture, cellOf, VIEW_W, VIEW_H, FLAGS, LETTERS, wrap, compile, start, play, pan, shownChoices, pageLength };
});
