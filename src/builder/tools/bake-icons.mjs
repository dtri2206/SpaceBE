// Bakes the card pictures: every part and every internals option rendered once in real Chrome, written to
// public/assets/icons/<name>.png (256 px, transparent) and listed in src/builder/data/icons.json, so the design page
// never waits for a model to download before it can show a card. Run from the project root:
//   node src/builder/tools/bake-icons.mjs
// Needs Google Chrome (the same as npm run check:boot).
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = path.join(ROOT, 'public/assets/icons');
const MANIFEST = path.join(ROOT, 'src/builder/data/icons.json');
const require = createRequire(path.join(ROOT, 'package.json'));
const { chromium } = require('playwright-core');
const { createServer } = await import(pathToFileURL(path.join(ROOT, 'node_modules/vite/dist/node/index.js')).href);
const safe = (key) => key.replace(/[^a-z0-9_.-]/gi, '-');

mkdirSync(OUT, { recursive: true });
// start with an empty manifest so the page renders live art instead of reading stale PNGs
writeFileSync(MANIFEST, JSON.stringify({ _about: JSON.parse(readFileSync(MANIFEST, 'utf8'))._about, icons: [] }, null, 2) + '\n');

const server = await createServer({ root: ROOT, logLevel: 'error', server: { port: 5181, strictPort: true, host: '127.0.0.1' } });
await server.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
page.on('pageerror', (e) => console.log(`page error: ${e.message}`));
await page.goto('http://127.0.0.1:5181/?debug=1&state=HANGAR');
await page.waitForFunction(() => window.__game && window.__game.frames > 20 && window.__game.builder, null, { timeout: 60000 });
// every real model first
const loaded = await page.evaluate(async () => {
  const b = window.__game.builder;
  const ids = b.catalog.parts.map((p) => p.id);
  const n = await b.requestArt(ids);
  return { n, missing: ids.filter((id) => b.nasa.NASA_PARTS[id] && !b.nasa.hasNasaArt(id)) };
});
console.log(`real models ready: ${loaded.n}, still missing: ${loaded.missing.join(', ') || 'none'}`);
await page.waitForTimeout(500);

const list = await page.evaluate(async () => {
  const b = window.__game.builder;
  const { catalog, icons } = b;
  const { internalsArt } = await import('/src/builder/bay/internalsArt.js');
  const { BASE_RADIUS, SIZE_SCALE } = await import('/src/builder/assembly.js');
  const shrink = (url, size = 256) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { const c = document.createElement('canvas'); c.width = c.height = size; c.getContext('2d').drawImage(img, 0, 0, size, size); resolve(c.toDataURL('image/png')); };
    img.onerror = () => resolve('');
    img.src = url;
  });
  const out = [];
  for (const def of catalog.parts) out.push({ key: def.id, url: await shrink(icons.renderPart(def)) });
  for (const [kitId, kit] of Object.entries(catalog.kits)) {
    const def = catalog.parts.find((p) => p.internals === kitId);
    if (!def) continue;
    const entry = { radius: BASE_RADIUS * (SIZE_SCALE[def.size] ?? 1), height: def.height };
    for (const slot of kit.slots) {
      for (const option of slot.options) {
        const opts = { ...catalog.optionsOf(def, null), [slot.key]: option };
        const piece = internalsArt(def, opts, entry).find((p) => p.key === slot.key);
        if (!piece) continue;
        out.push({ key: `int:${kitId}:${slot.key}:${option.id}`, url: await shrink(icons.renderObject(piece.object, { pad: 1.25 })) });
      }
    }
  }
  return out;
});
const icons = [];
for (const { key, url } of list) {
  if (!url) { console.log('skipped', key); continue; }
  writeFileSync(path.join(OUT, `${safe(key)}.png`), Buffer.from(url.split(',')[1], 'base64'));
  icons.push(key);
}
writeFileSync(MANIFEST, JSON.stringify({ _about: JSON.parse(readFileSync(MANIFEST, 'utf8'))._about, icons }, null, 2) + '\n');
console.log(`baked ${icons.length} icons into ${OUT}`);
await browser.close();
await server.close();
