import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePreviewSeekMessage } from '../engine/what-if/src/preview_protocol.js';

const source = {};
const timeline = [{ id: 'scene-a', dur: 2, start: 0 }];
const event = (data, origin = 'https://studio.local', eventSource = source) => ({ origin, source: eventSource, data });
const context = { origin: 'https://studio.local', source, timeline, previewId: 'expected-preview-token' };

test('accepts an in-range seek only from the expected same-origin parent', () => {
  assert.deepEqual(validatePreviewSeekMessage(event({ type: 'scene-preview:seek', preview_id: 'expected-preview-token', scene_id: 'scene-a', local_time: 1.25 }), context), {
    scene: timeline[0], local_time: 1.25,
  });
});

test('rejects wrong origin, wrong source, malformed types, unknown scenes, and invalid timestamps', () => {
  const valid = { type: 'scene-preview:seek', preview_id: 'expected-preview-token', scene_id: 'scene-a', local_time: 1 };
  assert.equal(validatePreviewSeekMessage(event(valid, 'https://attacker.invalid'), context), null);
  assert.equal(validatePreviewSeekMessage(event(valid, 'https://studio.local', {}), context), null);
  assert.equal(validatePreviewSeekMessage(event({ ...valid, preview_id: 'stale-preview-token' }), context), null);
  for (const local_time of [-1, 2, Infinity, NaN, '1']) {
    assert.equal(validatePreviewSeekMessage(event({ ...valid, local_time }), context), null);
  }
  assert.equal(validatePreviewSeekMessage(event({ ...valid, scene_id: '../bad' }), context), null);
  assert.equal(validatePreviewSeekMessage(event({ type: 'render', scene_id: 'scene-a', local_time: 1 }), context), null);
});
