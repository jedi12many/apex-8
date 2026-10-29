// Builds single-file versions of the playable pages, with their scripts and level inlined, so they
// run with no server or fetch:
//   web/out/<name>-play.html      a whole page, to open anywhere
//   web/out/<name>-artifact.html  the same body for publishing as a claude.ai artifact (no html/head/body
//                                 tags: the viewer adds its own, so the title, meta and styles go first)
// for ray.html (the raycaster, the Cell Block), side.html (the platformer, Green Hills), shmup.html
// (the shoot-'em-up, the Dreadnought) and crypt.html (the Drowned Crypt). A page can be given more globals
// to inline (extra).
//
//   node web/bundle.js
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const out = path.join(__dirname, 'out');
fs.mkdirSync(out, { recursive: true });

function bundle(page, levelFile, name, extra = {}) {
  let html = fs.readFileSync(path.join(__dirname, page), 'utf8');
  html = html.replace(/<script src="\.\.\/([^"]+)"><\/script>/g, (_, file) =>
    `<script>\n${fs.readFileSync(path.join(root, file), 'utf8').replace(/<\/script/g, '<\\/script')}\n</script>`);
  const level = fs.readFileSync(path.join(root, levelFile), 'utf8');
  const anchor = /<script>\r?\n\/\/ [^\n]*reference, playable/;
  if (!anchor.test(html)) throw new Error(`web/${page}: the main script has moved; update web/bundle.js`);
  const globals = Object.entries({ LEVEL_TEXT: level, ...extra }).map(([k, v]) => `window.${k} = ${JSON.stringify(v)};`).join(' ');
  html = html.replace(anchor, m => `<script>${globals}</script>\n${m}`);
  fs.writeFileSync(path.join(out, `${name}-play.html`), html);

  const title = html.match(/<title>.*?<\/title>/)[0], style = html.match(/<style>[\s\S]*?<\/style>/)[0];
  const body = html.match(/<body>([\s\S]*)<\/body>/)[1];
  const artifact = [
    title,
    '<meta name="claude:viewport-fit-sides" content="cover">',
    style.replace('padding: 16px; box-sizing: border-box; min-height: 100vh;',
      'padding-block: 16px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); box-sizing: border-box; min-height: 100%;'),
    body,
  ].join('\n');
  fs.writeFileSync(path.join(out, `${name}-artifact.html`), artifact);
  console.log(`web/out/${name}-play.html ${html.length} bytes, web/out/${name}-artifact.html ${artifact.length} bytes`);
}

bundle('side.html', 'levels/side/w1.txt', 'side');
bundle('shmup.html', 'levels/shmup/s1.txt', 'shmup');
bundle('crypt.html', 'levels/iso/c1.txt', 'crypt');
bundle('ray.html', 'levels/e1m1.txt', 'ray');
