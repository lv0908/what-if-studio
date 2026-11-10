import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { renderDuration, sampleTimelineDuration, storyboardDuration, frameRanges, sceneFrameRanges, frameRangesForInterval, audioTrimRange, sceneAudioFilter } from '../scripts/story_timeline.mjs';

const source = fs.readFileSync('engine/what-if/src/main.js', 'utf8');

test('storyboard duration is used instead of sample timeline duration', () => {
  const story = { scenes: [{ duration: 8.25 }, { duration: 11.75 }] };
  assert.equal(storyboardDuration(story), 20);
  assert.equal(renderDuration(source, story), 20);
});

test('sample duration parser preserves existing sample timeline', () => {
  assert.equal(sampleTimelineDuration(source), 65.5);
  assert.equal(renderDuration(source, null), 65.5);
});

test('legacy sample timeline scaler accepts the mutable timeline declaration', () => {
  const scaler = fs.readFileSync('scripts/story_scale.py', 'utf8');
  const api = fs.readFileSync('app/main.py', 'utf8');
  assert.ok(scaler.includes("timeline = re.search(r'export\\s+(?:const|let)\\s+TIMELINE"));
  assert.match(api, /from scripts\.story_scale import scale_timeline/);
});

test('story duration rejects empty and nonpositive scene timings', () => {
  assert.equal(storyboardDuration({ scenes: [] }), null);
  assert.throws(() => storyboardDuration({ scenes: [{ duration: 0 }] }), /positive/);
  assert.throws(() => storyboardDuration({ scenes: [{ duration: Infinity }] }), /positive/);
});

test('parallel chunk ranges cover every frame once with no gaps or overlaps', () => {
  for (const [duration, fps, chunks] of [[30, 30, 2], [45, 24, 3], [65.5, 30, 4]]) {
    const ranges = frameRanges(duration, fps, chunks);
    assert.equal(ranges[0][0], 0);
    assert.equal(ranges.at(-1)[1], Math.round(duration * fps));
    for (let i = 1; i < ranges.length; i++) assert.equal(ranges[i - 1][1], ranges[i][0]);
  }
});

test('scene frame ranges use cumulative half-open boundaries and preserve both durations', () => {
  const story = { scenes: [
    { id: 'a', duration: 1.01 },
    { id: 'b', duration: 1.01 },
    { id: 'c', duration: 0.98 },
  ] };
  const ranges = sceneFrameRanges(story, 30);
  assert.deepEqual(ranges.get('a'), { start_frame: 0, end_frame: 30, scene_duration: 1.01, rendered_duration: 1 });
  assert.deepEqual(ranges.get('b'), { start_frame: 30, end_frame: 61, scene_duration: 1.01, rendered_duration: 31 / 30 });
  assert.deepEqual(ranges.get('c'), { start_frame: 61, end_frame: 90, scene_duration: 0.98, rendered_duration: 29 / 30 });
  assert.equal([...ranges.values()].reduce((sum, range) => sum + range.end_frame - range.start_frame, 0), Math.round(3 * 30));
});

test('selected ranges split without gaps, retain first/last frames, and derive matching audio offset', () => {
  const chunks = frameRangesForInterval(31, 91, 4);
  assert.deepEqual(chunks, [[31, 46], [46, 61], [61, 76], [76, 91]]);
  assert.equal(chunks[0][0], 31);
  assert.equal(chunks.at(-1)[1] - 1, 90);
  assert.deepEqual(audioTrimRange(31, 91, 30), { start_seconds: 31 / 30, duration_seconds: 2 });
  assert.equal(sceneAudioFilter(31, 91, 30), 'atrim=start=1.033333333:duration=2.000000000,asetpts=PTS-STARTPTS,apad,atrim=duration=2.000000000');
});

test('full episode frame partition remains unchanged without optional scene bounds', () => {
  assert.deepEqual(frameRanges(10, 30, 3), [[0, 100], [100, 200], [200, 300]]);
});

test('scene ranges reject duplicate IDs, invalid durations, and scenes shorter than a frame', () => {
  assert.throws(() => sceneFrameRanges({ scenes: [{ id: 'same', duration: 1 }, { id: 'same', duration: 1 }] }), /unique/);
  assert.throws(() => sceneFrameRanges({ scenes: [{ id: 'short', duration: 0.001 }] }), /shorter than one frame/);
});

test('parallel and browser render paths consume the same saved storyboard file', () => {
  const parallel = fs.readFileSync('scripts/render_parallel.mjs', 'utf8');
  const browser = fs.readFileSync('scripts/render.mjs', 'utf8');
  assert.match(parallel, /story\.json/);
  assert.match(parallel, /renderDuration\(main, story\)/);
  assert.match(browser, /story\.json/);
  assert.match(browser, /renderDuration\(fs\.readFileSync[\s\S]*renderStory\)/);
  assert.match(browser, /DURATION - expectedDuration/);
});

test('dynamic cut transitions bypass black fades and renderer cleanup disposes GPU resources', () => {
  const main = fs.readFileSync('engine/what-if/src/main.js', 'utf8');
  const render = fs.readFileSync('scripts/render.mjs', 'utf8');
  assert.match(main, /s\.visual\?\.transition === 'cut'/);
  assert.match(main, /textures\.forEach\(\(texture\) => texture\.dispose\(\)\)/);
  assert.match(main, /geometries\.forEach\(\(geometry\) => geometry\.dispose\(\)\)/);
  assert.match(main, /renderer\.dispose\(\)/);
  assert.match(render, /finally\s*\{/);
  assert.match(render, /browser\.close\(\)/);
  assert.match(render, /encoder\.kill\('SIGTERM'\)/);
  const parallel = fs.readFileSync('scripts/render_parallel.mjs', 'utf8');
  assert.match(parallel, /p\.once\('error'/);
  assert.match(parallel, /const stopAll/);
});

test('all nine bundled scene builders remain imported and present', () => {
  const a = fs.readFileSync('engine/what-if/src/scenes-a.js', 'utf8');
  const b = fs.readFileSync('engine/what-if/src/scenes-b.js', 'utf8');
  const main = fs.readFileSync('engine/what-if/src/main.js', 'utf8');
  for (const name of ['plaza', 'hospital', 'cemetery', 'street']) { assert.match(a, new RegExp(`export function ${name}\\(`)); assert.match(main, new RegExp(`\\b${name}\\b`)); }
  for (const name of ['market', 'park', 'ocean', 'launch', 'earth']) { assert.match(b, new RegExp(`export function ${name}\\(`)); assert.match(main, new RegExp(`\\b${name}\\b`)); }
});

test('dynamic scene updates consume absolute local time and stay independent of render chunk boundaries', () => {
  const interpreter = fs.readFileSync('engine/what-if/src/interpreter.js', 'utf8');
  const main = fs.readFileSync('engine/what-if/src/main.js', 'utf8');
  const parallel = fs.readFileSync('scripts/render_parallel.mjs', 'utf8');
  assert.match(interpreter, /eventTimeline\.evaluate\(Math\.max\(0,Math\.min\(t,duration\)\)/);
  assert.match(main, /shot\.update\(local, s\.dur\)/);
  assert.match(parallel, /frameRanges\(total, FPS, N\)/);
});
