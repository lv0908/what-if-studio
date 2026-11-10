import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { playbackStartupTimestamp, previewStartupTimestamp } from '../engine/what-if/src/preview_time.js';
import { validatePreviewSeekMessage } from '../engine/what-if/src/preview_protocol.js';

const main = fs.readFileSync('engine/what-if/src/main.js', 'utf8');
const ui = fs.readFileSync('app/index.html', 'utf8');

test('preview startup begins at the visible 0.7-second timestamp', () => {
  assert.equal(previewStartupTimestamp(30), 0.7);
  assert.equal(playbackStartupTimestamp({ previewMode: true, explicitTimestamp: null, sceneDuration: 30 }), 0.7);
  assert.match(main, /offset = playbackStartupTimestamp\([\s\S]*sceneDuration: TIMELINE\[0\]\?\.dur/);
  assert.match(ui, /Math\.round\(0\.7\*30\)/);
});

test('preview startup clamps strictly inside short scene durations', () => {
  const start = previewStartupTimestamp(0.4);
  assert.equal(start, 0.399);
  assert.ok(start >= 0 && start < 0.4);
  assert.equal(previewStartupTimestamp(0), 0);
  assert.equal(previewStartupTimestamp(Number.NaN), 0);
});

test('explicit zero seek remains accepted and the authored fade calculation remains intact', () => {
  const parent = {};
  const timeline = [{ id: 'scene-a', dur: 2, start: 0 }];
  const seek = validatePreviewSeekMessage({
    origin: 'https://studio.local', source: parent,
    data: { type: 'scene-preview:seek', preview_id: 'preview-token-0123456789abcdef', scene_id: 'scene-a', local_time: 0 },
  }, { origin: 'https://studio.local', source: parent, timeline, previewId: 'preview-token-0123456789abcdef' });
  assert.equal(seek.local_time, 0);
  assert.match(main, /renderAt\(seek\.scene\.start \+ seek\.local_time\)/);
  assert.match(main, /const black = cut \? 0 : Math\.max\(1 - smooth\(local \/ fin\)/);
});

test('normal episode playback keeps its existing zero default and explicit timestamp behavior', () => {
  assert.equal(playbackStartupTimestamp({ previewMode: false, explicitTimestamp: null, sceneDuration: 30 }), 0);
  assert.equal(playbackStartupTimestamp({ previewMode: false, explicitTimestamp: 3.25, sceneDuration: 30 }), 3.25);
  assert.match(main, /previewMode: PREVIEW_MODE/);
  assert.match(main, /explicitTimestamp: params\.has\('t'\) \? Number\(params\.get\('t'\) \|\| 0\) : null/);
});
