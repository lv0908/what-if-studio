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
import { createInterface } from 'node:readline';
import { finished } from 'node:stream/promises';
import { renderDuration, frameRanges, frameRangesForInterval, sceneAudioFilter } from './story_timeline.mjs';
import { RenderProgressTracker } from './render_progress.mjs';
import { validateSceneOutput } from './scene_media.mjs';

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
const fullFrames = Math.round(total * FPS);
if (!fullFrames) { console.error('Could not read scene durations from src/main.js'); process.exit(1); }
const hasFromFrame = args['from-frame'] !== undefined;
const hasToFrame = args['to-frame'] !== undefined;
if (hasFromFrame !== hasToFrame) throw new Error('Both --from-frame and --to-frame are required together.');
const sceneRange = hasFromFrame ? [Number(args['from-frame']), Number(args['to-frame'])] : null;
if (sceneRange && (!sceneRange.every(Number.isInteger) || sceneRange[0] < 0 || sceneRange[1] <= sceneRange[0] || sceneRange[1] > fullFrames)) {
  throw new Error(`Invalid half-open frame range; expected 0 <= start < end <= ${fullFrames}.`);
}
const requireAudio = args['require-audio'] === true || args['require-audio'] === 'true';
if (requireAudio && !sceneRange) throw new Error('--require-audio is supported only with an explicit frame range.');
const frames = sceneRange ? sceneRange[1] - sceneRange[0] : fullFrames;

// chunk frame ranges [f0, f1)
const chunkCount = sceneRange ? Math.min(N, frames) : N;
const ranges = sceneRange
  ? frameRangesForInterval(sceneRange[0], sceneRange[1], chunkCount)
  : frameRanges(total, FPS, N);
const progressRanges = sceneRange ? ranges.map(([start, end]) => [start - sceneRange[0], end - sceneRange[0]]) : ranges;
const renderedDuration = frames / FPS;
const summaryDuration = sceneRange ? renderedDuration : total;
console.log(`${sceneRange ? `${sceneRange[0]}-${sceneRange[1]} ` : ''}${summaryDuration}s = ${frames} frames at ${FPS}fps, ${ranges.length} chunks:`, ranges.map((r) => r.join('-')).join(', '));
const progress = new RenderProgressTracker(progressRanges, frames);
const emitProgress = (renderComplete = false, chunkId = null) => {
  console.log('WHATIF_PROGRESS ' + JSON.stringify({
    event: 'render_progress', stage: 'rendering', frame_kind: 'captured',
    ...progress.snapshot(), render_complete: renderComplete, chunk_id: chunkId,
  }));
};

const count = (f) => { try { return Number(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', f]).toString().trim()); } catch { return 0; } };
const audioProbe = () => {
  if (!fs.existsSync(AUDIO)) {
    if (requireAudio) throw new Error(`Required soundtrack is missing: ${AUDIO}`);
    return false;
  }
  if (!sceneRange) return true;
  let info;
  try {
    info = JSON.parse(execFileSync('ffprobe', [
      '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_type,duration',
      '-show_entries', 'format=duration', '-of', 'json', AUDIO,
    ]).toString());
  } catch (error) {
    throw new Error(`Required soundtrack is invalid: ${error.message}`);
  }
  const stream = (info.streams || []).find((entry) => entry.codec_type === 'audio');
  const duration = Number(stream?.duration ?? info.format?.duration);
  const requiredEnd = sceneRange[1] / FPS;
  if (!stream || !Number.isFinite(duration) || duration + (1 / FPS) < requiredEnd) {
    throw new Error('Required soundtrack has no valid audio stream or does not cover the selected scene interval.');
  }
  return true;
};
const sceneHasAudio = sceneRange ? audioProbe() : null;
const procs = [];
const jobs = ranges.map(([f0, f1], i) => {
  const out = path.join(CH, `chunk-${i}.mp4`);
  const expected = f1 - f0;
  if (fs.existsSync(out) && count(out) === expected) {
    progress.complete(i, expected);
    console.log(`chunk ${i}: already done`);
    emitProgress(false, i);
    return Promise.resolve(out);
  }
  const log = fs.createWriteStream(path.join(CH, `chunk-${i}.log`), { flags: 'w' });
  const p = spawn('node', [path.join(HERE, 'render.mjs'), '--project', ROOT, '--from', String(f0 / FPS), '--to', String(f1 / FPS), '--w', String(W), '--h', String(H), '--fps', String(FPS), '--out', out], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  procs.push(p);
  let settled = false;
  const lines = createInterface({ input: p.stdout });
  lines.on('line', (line) => {
    log.write(`${line}\n`);
    if (!line.startsWith('WHATIF_PROGRESS ')) return;
    try {
      const event = JSON.parse(line.slice('WHATIF_PROGRESS '.length));
      if (event.event !== 'render_progress' || event.frame_kind !== 'captured' || event.total_frames !== expected) return;
      progress.report(i, event.completed_frames);
      emitProgress(false, i);
    } catch { /* Ignore malformed child telemetry; process and output checks remain authoritative. */ }
  });
  p.stderr.on('data', (data) => log.write(data));
  return new Promise((res, rej) => {
    p.once('error', (error) => {
      if (settled) return;
      settled = true; progress.fail(i); emitProgress(false, i); log.end();
      rej(new Error(`chunk ${i} could not start: ${error.message}`));
    });
    p.once('close', async (code) => {
      if (settled) return;
      settled = true; lines.close(); log.end();
      try { await finished(log); } catch {}
      if (code !== 0) {
        progress.fail(i); emitProgress(false, i);
        rej(new Error(`chunk ${i} failed (exit ${code}); see ${path.join(CH, `chunk-${i}.log`)}`));
        return;
      }
      const actual = count(out);
      if (actual !== expected) {
        progress.fail(i); emitProgress(false, i);
        rej(new Error(`chunk ${i} has ${actual} frames, expected exactly ${expected}; see ${path.join(CH, `chunk-${i}.log`)}`));
        return;
      }
      progress.complete(i, actual);
      emitProgress(false, i);
      res(out);
    });
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
ranges.forEach(([f0, f1], i) => { const n = count(outs[i]); if (n !== f1 - f0) { console.error(`chunk ${i} has ${n} frames, expected exactly ${f1 - f0}`); process.exit(1); } });
const inputs = outs.flatMap((o) => ['-i', o]);
const trims = outs.map((_, i) => `[${i}:v]trim=end_frame=${ranges[i][1] - ranges[i][0]},setpts=PTS-STARTPTS[v${i}]`).join(';');
const filter = `${trims};${outs.map((_, i) => `[v${i}]`).join('')}concat=n=${outs.length}:v=1:a=0,format=yuv420p[v]`;
const hasAudio = sceneRange ? sceneHasAudio : fs.existsSync(AUDIO);
const sceneAudioFilterValue = sceneRange
  ? sceneAudioFilter(sceneRange[0], sceneRange[1], FPS)
  : 'apad';
const audioMap = sceneRange ? `${outs.length}:a:0` : `${outs.length}:a`;
const ff = ['-y', '-loglevel', 'error', ...inputs, ...(hasAudio ? ['-i', AUDIO] : []), '-filter_complex', filter, '-map', '[v]',
  ...(hasAudio ? ['-map', audioMap, '-af', sceneAudioFilterValue, '-c:a', 'aac', '-b:a', '192k'] : []), '-t', (frames / FPS).toFixed(4),
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-profile:v', 'high', '-r', String(FPS), '-movflags', '+faststart', OUT];
execFileSync('ffmpeg', ff, { stdio: 'inherit' });
if (!progress.snapshot().all_chunks_complete) throw new Error('Cannot complete render: one or more chunks are incomplete.');
if (sceneRange) {
  let output;
  try {
    output = JSON.parse(execFileSync('ffprobe', [
      '-v', 'error', '-count_frames', '-show_entries',
      'stream=codec_type,width,height,avg_frame_rate,nb_read_frames:format=duration', '-of', 'json', OUT,
    ]).toString());
  } catch (error) {
    throw new Error(`Final scene MP4 validation failed: ${error.message}`);
  }
  validateSceneOutput(output, { frames, width: W, height: H, fps: FPS });
}
emitProgress(true);
console.log(`wrote ${OUT}${hasAudio ? '' : ' (no soundtrack found, video only)'}`);
