// Builds single-file versions of web/side.html, with its scripts and level inlined, so they run with
// no server or fetch:
//   web/out/side-play.html      a whole page, to open anywhere
//   web/out/side-artifact.html  the same body for publishing as a claude.ai artifact (no html/head/body
//                               tags: the viewer adds its own, so the title, meta and styles go first)
//
//   node web/bundle.js
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
let html = fs.readFileSync(path.join(__dirname, 'side.html'), 'utf8');
html = html.replace(/<script src="\.\.\/([^"]+)"><\/script>/g, (_, file) =>
  `<script>\n${fs.readFileSync(path.join(root, file), 'utf8').replace(/<\/script/g, '<\\/script')}\n</script>`);
const level = fs.readFileSync(path.join(root, 'levels', 'side', 'w1.txt'), 'utf8');
const anchor = /<script>\r?\n\/\/ The APEX platformer reference, playable/;
if (!anchor.test(html)) throw new Error('web/side.html: the main script has moved; update web/bundle.js');
html = html.replace(anchor, m => `<script>window.LEVEL_TEXT = ${JSON.stringify(level)};</script>\n${m}`);
const out = path.join(__dirname, 'out');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'side-play.html'), html);

const title = html.match(/<title>.*?<\/title>/)[0], style = html.match(/<style>[\s\S]*?<\/style>/)[0];
const body = html.match(/<body>([\s\S]*)<\/body>/)[1];
const artifact = [
  title,
  '<meta name="claude:viewport-fit-sides" content="cover">',
  style.replace('padding: 16px; box-sizing: border-box; min-height: 100vh;',
    'padding-block: 16px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); box-sizing: border-box; min-height: 100%;'),
  body,
].join('\n');
fs.writeFileSync(path.join(out, 'side-artifact.html'), artifact);
console.log(`web/out/side-play.html ${html.length} bytes, web/out/side-artifact.html ${artifact.length} bytes`);
