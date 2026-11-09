// node branding/render.mjs  -> branding/hypothetica-profile.png, hypothetica-cover.png, preview-*.png
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
if (process.argv.includes('--earthb-only')) process.env.EB_ONLY = '1';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.woff2': 'font/woff2', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

async function grab(url, w, h, out, scale = 1) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
  page.on('pageerror', (e) => console.log('[page error]', e.message));
  await page.goto(base + url);
  await page.waitForFunction(() => window.__done === true, null, { timeout: 120000 });
  await page.screenshot({ path: path.join(HERE, out), clip: { x: 0, y: 0, width: w, height: h } });
  await page.close();
  console.log('wrote', out);
}
if (!process.env.EB_ONLY) {
await grab('/branding/brand.html?kind=profile', 1080, 1080, 'hypothetica-profile.png');
await grab('/branding/brand.html?kind=cover', 1640, 924, 'hypothetica-cover.png');
await grab('/branding/brand.html?kind=cover&guides', 1640, 924, 'cover-safe-areas.png');
await grab('/branding/preview.html?view=desktop', 1280, 760, 'preview-desktop.png');
await grab('/branding/preview.html?view=mobile', 390, 844, 'preview-mobile.png', 2);
}
fs.mkdirSync(path.join(HERE, 'earth-b'), { recursive: true });
await grab('/branding/brand.html?brand=earthb&kind=profile', 1080, 1080, 'earth-b/earth-b-profile.png');
await grab('/branding/brand.html?brand=earthb&kind=cover', 1640, 924, 'earth-b/earth-b-cover.png');
await grab('/branding/brand.html?brand=earthb&kind=cover&guides', 1640, 924, 'earth-b/cover-safe-areas.png');
await grab('/branding/preview.html?view=desktop&brand=earthb', 1280, 760, 'earth-b/preview-desktop.png');
await grab('/branding/preview.html?view=mobile&brand=earthb', 390, 844, 'earth-b/preview-mobile.png', 2);
await browser.close(); server.close();
