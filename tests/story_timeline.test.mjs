import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { renderDuration, sampleTimelineDuration, storyboardDuration, frameRanges } from '../scripts/story_timeline.mjs';

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
