import unittest

from app.scene_preview import PreviewCapacityError, PreviewStoryTooLarge, ScenePreviewSessions
from app.scene_render import SceneFrameRangeError, audio_trim_range, scene_frame_ranges, storyboard_fingerprint, validate_audio_probe


class FakeClock:
    def __init__(self): self.value = 0.0
    def __call__(self): return self.value
    def advance(self, seconds): self.value += seconds


class SceneRenderMathTests(unittest.TestCase):
    def test_cumulative_scene_ranges_preserve_authored_and_rendered_durations(self):
        story = {'scenes': [
            {'id': 'a', 'duration': 1.01},
            {'id': 'b', 'duration': 1.01},
            {'id': 'c', 'duration': 0.98},
        ]}
        ranges = scene_frame_ranges(story, 30)
        self.assertEqual(ranges['a'], {
            'start_frame': 0, 'end_frame': 30, 'scene_duration': 1.01, 'rendered_duration': 1,
        })
        self.assertEqual(ranges['b'], {
            'start_frame': 30, 'end_frame': 61, 'scene_duration': 1.01, 'rendered_duration': 31 / 30,
        })
        self.assertEqual(ranges['c'], {
            'start_frame': 61, 'end_frame': 90, 'scene_duration': 0.98, 'rendered_duration': 29 / 30,
        })
        self.assertEqual(ranges['a']['end_frame'], ranges['b']['start_frame'])
        self.assertEqual(ranges['b']['end_frame'], ranges['c']['start_frame'])
        self.assertEqual(ranges['c']['end_frame'], 90)

    def test_rejects_duplicate_ids_invalid_durations_and_zero_frame_scenes(self):
        with self.assertRaises(SceneFrameRangeError):
            scene_frame_ranges({'scenes': [{'id': 'x', 'duration': 1}, {'id': 'x', 'duration': 1}]})
        with self.assertRaises(SceneFrameRangeError):
            scene_frame_ranges({'scenes': [{'id': 'x', 'duration': 0.001}]})
        with self.assertRaises(SceneFrameRangeError):
            scene_frame_ranges({'scenes': [{'id': 'x', 'duration': float('nan')}]})

    def test_audio_trim_uses_episode_frame_offset_and_rendered_duration(self):
        self.assertEqual(audio_trim_range(31, 62, 30), (31 / 30, 31 / 30))

    def test_soundtrack_probe_rejects_missing_invalid_and_too_short_audio(self):
        with self.assertRaisesRegex(ValueError, 'no valid audio'):
            validate_audio_probe({'streams': []}, 5)
        with self.assertRaisesRegex(ValueError, 'valid duration'):
            validate_audio_probe({'streams': [{'codec_type': 'audio', 'duration': 'bad'}]}, 5)
        with self.assertRaisesRegex(ValueError, 'does not cover'):
            validate_audio_probe({'streams': [{'codec_type': 'audio', 'duration': '2'}]}, 5)
        self.assertEqual(validate_audio_probe({'streams': [{'codec_type': 'audio', 'duration': '4.99'}]}, 5), 4.99)

    def test_storyboard_fingerprint_is_key_order_independent_and_content_sensitive(self):
        first = {'title': 'scene', 'scenes': [{'id': 'a', 'duration': 1}]}
        reordered = {'scenes': [{'duration': 1, 'id': 'a'}], 'title': 'scene'}
        changed = {'title': 'scene', 'scenes': [{'id': 'a', 'duration': 2}]}
        self.assertEqual(storyboard_fingerprint(first), storyboard_fingerprint(reordered))
        self.assertNotEqual(storyboard_fingerprint(first), storyboard_fingerprint(changed))


class ScenePreviewSessionTests(unittest.TestCase):
    def test_tokens_are_unpredictable_sessions_validate_and_return_isolated_snapshots(self):
        sessions = ScenePreviewSessions()
        story = {'scenes': [{'id': 's1', 'duration': 1}]}
        token, expires_at = sessions.create(story)
        self.assertNotEqual(token, sessions.create(story)[0])
        self.assertGreaterEqual(len(token), 32)
        self.assertTrue(expires_at.endswith('Z'))
        snapshot = sessions.get(token)
        snapshot['scenes'][0]['title'] = 'mutated copy'
        self.assertNotIn('title', sessions.get(token)['scenes'][0])
        self.assertIsNone(sessions.get('../invalid'))
        self.assertIsNone(sessions.get('unknown-token-value-that-is-long-enough'))

    def test_sessions_expire_and_capacity_and_payload_size_are_bounded(self):
        clock = FakeClock()
        sessions = ScenePreviewSessions(max_sessions=1, ttl_seconds=5, max_story_bytes=40, clock=clock)
        token, _ = sessions.create({'s': 1})
        with self.assertRaises(PreviewCapacityError):
            sessions.create({'s': 2})
        clock.advance(5)
        self.assertIsNone(sessions.get(token))
        sessions.create({'s': 2})
        with self.assertRaises(PreviewStoryTooLarge):
            sessions.create({'story': 'x' * 100})


if __name__ == '__main__':
    unittest.main()
