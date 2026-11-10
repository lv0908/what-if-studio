// Render an episode in N parallel chunks, join them frame-exactly, and mux the soundtrack.
//   node render_parallel.mjs --project <episode dir> [--chunks 3] [--w 1080 --h 1920 --fps 30]
//                            [--audio media/soundtrack.m4a] [--out media/final.mp4]
//
// Chunk boundaries are placed on exact frame times so the joined film has no duplicate or
// missing frames. Each chunk is its own detached process group; if one fails, the others are
// stopped and the error is printed. Re-running reuses chunks that already finished (delete
// media/chunks/ to force a full re-render).
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { renderDuration, frameRanges } from './story_timeline.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]] : a), []));
const ROOT = path.resolve(args.project || process.cwd());
const N = Number(args.chunks || 3), FPS = Number(args.fps || 30), W = args.w || 1080, H = args.h || 1920;
const OUT = path.resolve(ROOT, args.out || 'media/final.mp4');
const AUDIO = path.resolve(ROOT, args.audio || 'media/soundtrack.m4a');
const CH = path.join(ROOT, 'media/chunks');
fs.mkdirSync(CH, { recursive: true });

// Match the storyboard file consumed by render.mjs; without one use the bundled timeline.
const main = fs.readFileSync(path.join(ROOT, 'src/main.js'), 'utf8');
const storyFile = path.join(ROOT, 'story.json');
const story = fs.existsSync(storyFile) ? JSON.parse(fs.readFileSync(storyFile, 'utf8')) : null;
const total = renderDuration(main, story);
const frames = Math.round(total * FPS);
if (!frames) { console.error('Could not read scene durations from src/main.js'); process.exit(1); }

// chunk frame ranges [f0, f1)
const ranges = frameRanges(total, FPS, N);
console.log(`${total}s = ${frames} frames at ${FPS}fps, ${N} chunks:`, ranges.map((r) => r.join('-')).join(', '));

const count = (f) => { try { return Number(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', f]).toString().trim()); } catch { return 0; } };
const procs = [];
const jobs = ranges.map(([f0, f1], i) => {
  const out = path.join(CH, `chunk-${i}.mp4`);
  if (fs.existsSync(out) && count(out) === f1 - f0) { console.log(`chunk ${i}: already done`); return Promise.resolve(out); }
  const log = fs.openSync(path.join(CH, `chunk-${i}.log`), 'w');
  const p = spawn('node', [path.join(HERE, 'render.mjs'), '--project', ROOT, '--from', String(f0 / FPS), '--to', String(f1 / FPS), '--w', String(W), '--h', String(H), '--fps', String(FPS), '--out', out], { stdio: ['ignore', log, log], detached: true });
  procs.push(p);
  return new Promise((res, rej) => {
    p.once('error', (error) => rej(new Error(`chunk ${i} could not start: ${error.message}`)));
    p.once('exit', (code) => (code === 0 ? res(out) : rej(new Error(`chunk ${i} failed (exit ${code}); see ${path.join(CH, `chunk-${i}.log`)}`))));
  });
});
const stopAll = () => procs.forEach((p) => { try { process.kill(-p.pid, 'SIGTERM'); } catch {} });
process.on('SIGINT', () => { stopAll(); process.exit(130); });
const ticker = setInterval(() => {
  const s = ranges.map((_, i) => { try { const l = fs.readFileSync(path.join(CH, `chunk-${i}.log`), 'utf8').trim().split('\n').filter((x) => x.startsWith('frame') || x.startsWith('wrote')).pop() || 'starting'; return `#${i} ${l.replace(/,.*$/, '')}`; } catch { return `#${i} done`; } });
  console.log(new Date().toISOString().slice(11, 19), s.join(' | '));
}, 60000);

let outs;
try { outs = await Promise.all(jobs); } catch (e) { stopAll(); clearInterval(ticker); console.error(e.message); process.exit(1); }
clearInterval(ticker);

// verify, join, mux
ranges.forEach(([f0, f1], i) => { const n = count(outs[i]); if (n < f1 - f0) { console.error(`chunk ${i} has ${n} frames, expected ${f1 - f0}`); process.exit(1); } });
const inputs = outs.flatMap((o) => ['-i', o]);
const trims = outs.map((_, i) => `[${i}:v]trim=end_frame=${ranges[i][1] - ranges[i][0]},setpts=PTS-STARTPTS[v${i}]`).join(';');
const filter = `${trims};${outs.map((_, i) => `[v${i}]`).join('')}concat=n=${outs.length}:v=1:a=0,format=yuv420p[v]`;
const hasAudio = fs.existsSync(AUDIO);
const ff = ['-y', '-loglevel', 'error', ...inputs, ...(hasAudio ? ['-i', AUDIO] : []), '-filter_complex', filter, '-map', '[v]',
  ...(hasAudio ? ['-map', `${outs.length}:a`, '-af', 'apad', '-c:a', 'aac', '-b:a', '192k'] : []), '-t', (frames / FPS).toFixed(4),
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-profile:v', 'high', '-r', String(FPS), '-movflags', '+faststart', OUT];
execFileSync('ffmpeg', ff, { stdio: 'inherit' });
console.log(`wrote ${OUT}${hasAudio ? '' : ' (no soundtrack found, video only)'}`);
