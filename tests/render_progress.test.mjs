import test from 'node:test';
import assert from 'node:assert/strict';
import { RenderProgressTracker } from '../scripts/render_progress.mjs';

test('aggregates captured frames by uneven chunk ranges', () => {
  const progress = new RenderProgressTracker([[0, 2], [2, 7], [7, 11]], 11);
  progress.report(0, 2);
  progress.report(1, 3);
  progress.report(2, 1);
  assert.deepEqual(progress.snapshot(), {
    completed_frames: 6, total_frames: 11, completed_chunks: 0, total_chunks: 3,
    all_chunks_complete: false,
  });
});

test('failed and interrupted chunks retain only frames actually reported', () => {
  const progress = new RenderProgressTracker([[0, 4], [4, 9]], 9);
  progress.report(0, 2);
  progress.fail(0);
  progress.report(0, 4);
  assert.throws(() => progress.complete(0, 4), /has failed/);
  progress.report(1, 3);
  assert.equal(progress.snapshot().completed_frames, 5);
  assert.equal(progress.snapshot().completed_chunks, 0);
  assert.equal(progress.snapshot().all_chunks_complete, false);
});

test('cached chunks complete only after exact frame-count verification', () => {
  const progress = new RenderProgressTracker([[0, 3], [3, 8]], 8);
  assert.throws(() => progress.complete(0, 4), /expected exactly 3/);
  assert.equal(progress.snapshot().completed_frames, 0);
  progress.complete(0, 3);
  assert.equal(progress.snapshot().completed_frames, 3);
  assert.equal(progress.snapshot().completed_chunks, 1);
});

test('chunk frame reports are monotonic, bounded, and never imply render completion', () => {
  const progress = new RenderProgressTracker([[0, 5], [5, 10]], 10);
  progress.report(0, 4);
  progress.report(0, 2);
  progress.report(1, 100);
  const snapshot = progress.snapshot();
  assert.equal(snapshot.completed_frames, 9);
  assert.equal(snapshot.all_chunks_complete, false);
  progress.complete(0, 5);
  progress.complete(1, 5);
  assert.equal(progress.snapshot().completed_frames, 10);
  assert.equal(progress.snapshot().all_chunks_complete, true);
});

test('chunk ranges must cover the frame timeline exactly once', () => {
  assert.throws(() => new RenderProgressTracker([[0, 3], [4, 8]], 8), /contiguously/);
  assert.throws(() => new RenderProgressTracker([[0, 3]], 8), /every frame/);
});
