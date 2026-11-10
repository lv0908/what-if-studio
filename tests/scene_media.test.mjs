import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSceneOutput } from '../scripts/scene_media.mjs';

const good = {
  streams: [
    { codec_type: 'video', nb_read_frames: '60', width: 480, height: 854, avg_frame_rate: '30/1' },
    { codec_type: 'audio' },
  ],
  format: { duration: '2.02' },
};
const expected = { frames: 60, width: 480, height: 854, fps: 30 };

test('accepts a scene MP4 only when frame count, audio, dimensions, FPS, and duration match', () => {
  assert.deepEqual(validateSceneOutput(good, expected), { rendered_duration: 2, frames: 60, audio: true });
});

test('rejects missing audio, wrong frames, dimensions, FPS, and duration', () => {
  for (const info of [
    { ...good, streams: [good.streams[0]] },
    { ...good, streams: [{ ...good.streams[0], nb_read_frames: '59' }, good.streams[1]] },
    { ...good, streams: [{ ...good.streams[0], width: 720 }, good.streams[1]] },
    { ...good, streams: [{ ...good.streams[0], avg_frame_rate: '24/1' }, good.streams[1]] },
    { ...good, format: { duration: '2.2' } },
  ]) assert.throws(() => validateSceneOutput(info, expected), /validation/);
});
