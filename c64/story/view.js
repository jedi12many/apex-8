/*
 * The story mode's C64 screen (core/story.js): what each frame shows, exactly as the engine is to
 * show it.
 *
 *   lines 0-3     the top border (24-row mode)
 *   lines 4-116   the window: a multicolor bitmap of the picture, panned to the pixel by the VIC's
 *                 fine scroll both ways, in 38 columns (the border covers x 0-6 and 311-319)
 *   lines 117-127 black (an invalid mode, its bad lines held off so every row of the window ends
 *                 before the text starts)
 *   lines 128-199 the text area, rows 16-24 in APEXSCII's text font on black, 38 columns:
 *                   row 16      the speaker's name, in yellow
 *                   rows 17-20  the page's text, typed so far, in white
 *                   rows 21-24  the choices, when they are shown, from column 3 in light grey; the
 *                               chosen one in a reversed bar from column 1 to 38
 *                 waiting for fire, a '>' blinks at the end of row 24
 *                 Each row's colour is fixed, so colour RAM never changes there. The font is
 *                 APEXSCII's 64 text glyphs, and the same reversed as codes 64-127.
 * The window is dark while a scene change readies the next picture.
 *
 * Works in Node and in the browser (global APEXSTORYVIEW, needing APEXSCII and APEXSTORY).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../../apexscii/apexscii.js'), require('../../core/story.js'));
  else root.APEXSTORYVIEW = factory(root.APEXSCII, root.APEXSTORY);
})(typeof self !== 'undefined' ? self : this, function (APEXSCII, STORY) {
  'use strict';

  const BORDER = 0, BG = 0, WIN_TOP = 4, WIN_END = 117, TEXT_ROW = 16;
  const ROW_COLOR = [7, 1, 1, 1, 1, 15, 15, 15, 15];
  const PROMPT = 0x3e;                        // '>'
  const PAL = APEXSCII.PALETTE.map(h => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16)));
  const TEXT = APEXSCII.buildDefault('hires', 'ray').glyphs.slice(0, 64);
  const FONT = [...TEXT, ...TEXT.map(g => Array.from(g, b => b ^ 0xff))];

  // The text area as 9 rows of 40 screen codes ($20 a space).
  function text(c, s) {
    const sc = c.scenes[s.scene], codes = new Uint8Array(360).fill(0x20);
    const put = (row, col, list) => list.forEach((k, i) => { codes[row * 40 + col + i] = k; });
    put(0, 1, sc.speaker);
    let left = s.shown;
    (sc.pages[s.page] || []).forEach((line, r) => { put(1 + r, 1, line.slice(0, Math.max(0, left))); left -= line.length; });
    if (!s.blank && s.phase === 'choose') {
      STORY.shownChoices(sc, s.flags).forEach((k, r) => {
        put(5 + r, 3, sc.choices[k].text);
        if (r === s.sel) for (let x = 1; x <= 38; x++) codes[(5 + r) * 40 + x] |= 0x40;
      });
    }
    if (!s.blank && (s.phase === 'more' || s.phase === 'done') && s.clock & 16) put(8, 38, [PROMPT]);
    return codes;
  }

  // A frame: 320 x 200 RGBA. pics: the story's pictures (c64/story/pictures.js decode), in its order.
  function frame(c, pics, s) {
    const px = new Uint8ClampedArray(320 * 200 * 4);
    const set = (x, y, k) => px.set([...PAL[k], 255], (y * 320 + x) * 4);
    const pic = pics[c.scenes[s.scene].picture], { x: panX, y: panY } = STORY.pan(s);
    for (let y = 0; y < WIN_END; y++) for (let x = 0; x < 320; x++) {
      if (y < WIN_TOP || x < 7 || x >= 311 || s.blank) { set(x, y, y < WIN_TOP || x < 7 || x >= 311 ? BORDER : BG); continue; }
      const ix = panX + x, iy = panY + y - WIN_TOP, cell = (iy >> 3) * pic.cw + (ix >> 3);
      const v = (pic.bitmap[cell * 8 + (iy & 7)] >> (6 - 2 * ((ix >> 1) & 3))) & 3;
      set(x, y, [pic.bg, pic.screen[cell] >> 4, pic.screen[cell] & 15, pic.colram[cell] & 15][v]);
    }
    for (let y = WIN_END; y < 128; y++) for (let x = 0; x < 320; x++) set(x, y, 0);
    const t = text(c, s);
    for (let r = 0; r < 9; r++) for (let cx = 0; cx < 40; cx++) {
      const g = FONT[t[r * 40 + cx] & 127], fg = ROW_COLOR[r];
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const X = cx * 8 + x, Y = (TEXT_ROW + r) * 8 + y;
        set(X, Y, X < 7 || X >= 311 ? BORDER : (g[y] >> (7 - x)) & 1 ? fg : BG);
      }
    }
    return { pixels: px, border: BORDER };
  }

  return { BORDER, BG, WIN_TOP, WIN_END, TEXT_ROW, ROW_COLOR, PROMPT, FONT, text, frame };
});
