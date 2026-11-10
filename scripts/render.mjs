// Render the film frame by frame with headless Chromium and encode it with ffmpeg.
//   node render.mjs --project <episode dir>                      -> <project>/media/video-only.mp4 (1080x1920, 30fps)
//   node render.mjs --project <dir> --stills 0.5,4,9 --w 540 --h 960   -> PNG stills in <project>/media/stills/
//   node render.mjs --project <dir> --from 10 --to 20 --out media/part.mp4
// The episode dir is the folder holding index.html (a copy of assets/template/what-if).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { renderDuration } from './story_timeline.mjs';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(path.join(process.env.PW_PATH || '/opt/node22/lib/node_modules', 'playwright')); }

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]] : a), []));
const ROOT = path.resolve(args.project && args.project !== true ? args.project : process.cwd());
if (!fs.existsSync(path.join(ROOT, 'index.html'))) { console.error(`No index.html in ${ROOT}; pass --project <episode dir>`); process.exit(1); }
const W = Number(args.w || 1080), H = Number(args.h || 1920), FPS = Number(args.fps || 30);
const OUT = path.resolve(ROOT, args.out || 'media/video-only.mp4');
const storyFile = path.join(ROOT, 'story.json');
const storyMode = fs.existsSync(storyFile);
const renderStory = storyMode ? JSON.parse(fs.readFileSync(storyFile, 'utf8')) : null;
const expectedDuration = renderDuration(fs.readFileSync(path.join(ROOT, 'src/main.js'), 'utf8'), renderStory);

const types = { '.html': 'text/html', '.js': 'text/javascript', '.woff2': 'font/woff2', '.m4a': 'audio/mp4', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
let browser, page, encoder;
try {
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, resolve); });
const port = server.address().port;

browser = await playwright.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text()); });
page.on('pageerror', (e) => console.log('[page error]', e.message));
await page.goto(`http://localhost:${port}/index.html?render&w=${W}&h=${H}${storyMode ? '&story=1' : ''}`);
await page.waitForFunction(() => window.__whatif);
await page.evaluate(() => window.__whatif.ready);
const DURATION = await page.evaluate(() => window.__whatif.DURATION);
if (Math.abs(DURATION - expectedDuration) > 0.001) throw new Error(`Browser timeline is ${DURATION}s; render scripts expect ${expectedDuration}s.`);

const shot = async (t) => { await page.evaluate((tt) => window.__whatif.renderAt(tt), t); return page.screenshot({ type: 'png' }); };

if (args.stills) {
  const dir = path.join(ROOT, 'media/stills'); fs.mkdirSync(dir, { recursive: true });
  for (const t of String(args.stills).split(',').map(Number)) {
    const t0 = Date.now();
    fs.writeFileSync(path.join(dir, `t${t.toFixed(2).padStart(6, '0')}.png`), await shot(t));
    console.log(`still t=${t} (${Date.now() - t0} ms)`);
  }
} else {
  const from = Number(args.from || 0), to = Math.min(Number(args.to || DURATION), DURATION);
  const n = Math.round((to - from) * FPS);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const ff = encoder = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', OUT], { stdio: ['pipe', 'inherit', 'inherit'] });
  let encodeError = null;
  ff.on('error', (error) => { encodeError = error; });
  ff.stdin.on('error', (error) => { encodeError = error; });
  const ffmpegClosed = new Promise((resolve) => ff.once('close', (code) => resolve(code)));
  const started = Date.now();
  for (let i = 0; i < n; i++) {
    const buf = await shot(from + i / FPS);
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if (i % 30 === 0) { const el = (Date.now() - started) / 1000; console.log(`frame ${i}/${n}  ${el.toFixed(0)}s elapsed, ~${((el / (i + 1)) * (n - i - 1)).toFixed(0)}s left`); }
  }
  ff.stdin.end();
  const exitCode = await ffmpegClosed;
  if (encodeError) throw encodeError;
  if (exitCode !== 0) throw new Error(`ffmpeg exited with code ${exitCode}`);
  console.log('wrote', OUT);
}
} finally {
  if (encoder && encoder.exitCode === null && encoder.signalCode === null) {
    encoder.kill('SIGTERM');
    await new Promise((resolve) => encoder.once('close', resolve));
  }
  if (page) await page.evaluate(() => window.__whatif?.dispose?.()).catch(() => {});
  if (browser) await browser.close().catch(() => {});
  if (server.listening) await new Promise((resolve) => server.close(resolve));
}
