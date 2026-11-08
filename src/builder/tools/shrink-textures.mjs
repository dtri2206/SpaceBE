// Shrinks the Poly Haven prop textures (public/assets/polyhaven/models/*/textures/*.jpg) to 512 px JPEGs in place,
// using Chrome's image encoder, so the engineering bay downloads a few megabytes instead of forty. The glTF files
// keep their URIs, so nothing else changes. Run from the project root: node src/builder/tools/shrink-textures.mjs [size]
import { createRequire } from 'node:module';
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MODELS = path.join(ROOT, 'public/assets/polyhaven/models');
const SIZE = Number(process.argv[2]) || 512;
const require = createRequire(path.join(ROOT, 'package.json'));
const { chromium } = require('playwright-core');

const files = [];
for (const dir of readdirSync(MODELS)) {
  const tex = path.join(MODELS, dir, 'textures');
  try { for (const f of readdirSync(tex)) if (/\.(jpe?g|png)$/i.test(f)) files.push(path.join(tex, f)); } catch { /* no textures folder */ }
}
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
let before = 0, after = 0;
for (const file of files) {
  const size = statSync(file).size;
  before += size;
  const dataUrl = `data:image/${/\.png$/i.test(file) ? 'png' : 'jpeg'};base64,${Buffer.from(require('node:fs').readFileSync(file)).toString('base64')}`;
  const isNormal = /_nor_/.test(file);
  const out = await page.evaluate(async ({ src, size: s, quality }) => {
    const img = new Image();
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = src; });
    if (img.width <= s) return null;
    const c = document.createElement('canvas');
    c.width = c.height = s;
    c.getContext('2d').drawImage(img, 0, 0, s, s);
    return c.toDataURL('image/jpeg', quality);
  }, { src: dataUrl, size: SIZE, quality: isNormal ? 0.9 : 0.82 });
  if (!out) { after += size; continue; }
  const buf = Buffer.from(out.split(',')[1], 'base64');
  const target = file.replace(/\.png$/i, '.jpg');
  writeFileSync(target, buf);
  if (target !== file) require('node:fs').unlinkSync(file);
  after += buf.length;
  console.log(`${path.relative(MODELS, file)}: ${(size / 1024).toFixed(0)} → ${(buf.length / 1024).toFixed(0)} KB`);
}
console.log(`${files.length} textures: ${(before / 1048576).toFixed(1)} MB → ${(after / 1048576).toFixed(1)} MB`);
await browser.close();
