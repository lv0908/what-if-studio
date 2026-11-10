"""Small, dependency-free helpers for renderer frame progress events."""

import json


PROGRESS_PREFIX = 'WHATIF_PROGRESS '


def parse_render_progress(line, expected_total_frames):
    """Return a valid captured-frame event, or None for unrelated/invalid log lines."""
    if not line.startswith(PROGRESS_PREFIX):
        return None
    try:
        event = json.loads(line[len(PROGRESS_PREFIX):])
    except (TypeError, ValueError):
        return None
    if not isinstance(event, dict) or event.get('event') != 'render_progress':
        return None
    if event.get('stage') != 'rendering' or event.get('frame_kind') != 'captured':
        return None
    completed = event.get('completed_frames')
    total = event.get('total_frames')
    if (isinstance(completed, bool) or not isinstance(completed, int) or completed < 0
            or isinstance(total, bool) or not isinstance(total, int) or total != expected_total_frames
            or completed > total):
        return None
    if 'render_complete' in event and not isinstance(event['render_complete'], bool):
        return None
    return event


def apply_render_progress(job, event):
    """Update additive job fields while keeping the legacy percentage monotonic and <100."""
    completed = max(job.get('completed_frames', 0), event['completed_frames'])
    total = event['total_frames']
    job['completed_frames'] = min(completed, total)
    job['total_frames'] = total
    job['stage'] = 'rendering'
    job['frame_progress_kind'] = 'captured_and_submitted'
    fraction = job['completed_frames'] / total if total else 0
    measured_progress = min(95, 10 + int(85 * fraction))
    job['progress'] = min(99, max(job.get('progress', 0), measured_progress))
    if event.get('render_complete'):
        job['message'] = 'Render process completed; publishing video'
    else:
        job['message'] = 'Rendering frames'
    return job
