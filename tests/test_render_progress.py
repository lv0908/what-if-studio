import json
import unittest

from app.render_progress import PROGRESS_PREFIX, apply_render_progress, parse_render_progress


def line(completed, total=100, **extra):
    event = {
        'event': 'render_progress',
        'stage': 'rendering',
        'frame_kind': 'captured',
        'completed_frames': completed,
        'total_frames': total,
        **extra,
    }
    return PROGRESS_PREFIX + json.dumps(event)


class RenderProgressTests(unittest.TestCase):
    def test_parser_accepts_capture_events_and_ignores_unrelated_or_invalid_lines(self):
        self.assertEqual(parse_render_progress(line(30), 100)['completed_frames'], 30)
        self.assertIsNone(parse_render_progress('frame 30/100', 100))
        self.assertIsNone(parse_render_progress(PROGRESS_PREFIX + '{', 100))
        self.assertIsNone(parse_render_progress(line(101), 100))
        self.assertIsNone(parse_render_progress(line(30, total=99), 100))

    def test_progress_is_monotonic_and_existing_api_fields_are_preserved(self):
        job = {'id': 'abc', 'topic': 'Test', 'duration': 30, 'status': 'rendering', 'progress': 10, 'message': 'Rendering'}
        apply_render_progress(job, parse_render_progress(line(60), 100))
        first_percent = job['progress']
        apply_render_progress(job, parse_render_progress(line(20), 100))
        self.assertEqual(job['completed_frames'], 60)
        self.assertEqual(job['progress'], first_percent)
        for field in ('id', 'topic', 'duration', 'status', 'progress', 'message'):
            self.assertIn(field, job)
        self.assertEqual(job['total_frames'], 100)
        self.assertEqual(job['stage'], 'rendering')

    def test_captured_frames_do_not_claim_encoding_or_allow_100_percent(self):
        job = {'progress': 10}
        event = parse_render_progress(line(100, render_complete=True), 100)
        apply_render_progress(job, event)
        self.assertEqual(job['completed_frames'], 100)
        self.assertEqual(job['progress'], 95)
        self.assertEqual(job['stage'], 'rendering')
        self.assertEqual(job['frame_progress_kind'], 'captured_and_submitted')
        self.assertNotIn('encoded_frames', job)
        self.assertIn('publishing video', job['message'])

    def test_progress_helper_does_not_mutate_terminal_job_fields(self):
        for status in ('completed', 'failed', 'stopped', 'interrupted'):
            job = {
                'id': 'abc', 'status': status, 'progress': 100 if status == 'completed' else 42,
                'completed_frames': 20, 'total_frames': 100, 'message': 'terminal', 'stage': 'rendering',
            }
            before = dict(job)
            apply_render_progress(job, parse_render_progress(line(90), 100))
            self.assertEqual(job, before)


if __name__ == '__main__':
    unittest.main()
