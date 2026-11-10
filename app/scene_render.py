"""Pure scene frame-range and storyboard identity helpers."""

from __future__ import annotations

import hashlib
import json
import math


class SceneFrameRangeError(ValueError):
    """A storyboard scene cannot be represented by a nonempty frame range."""


def _frame_boundary(seconds: float, fps: int) -> int:
    # Match JavaScript Math.round for nonnegative frame positions.
    return math.floor(seconds * fps + 0.5)


def scene_frame_ranges(story: dict, fps: int = 30) -> dict[str, dict[str, int | float]]:
    scenes = story.get('scenes') if isinstance(story, dict) else None
    if not isinstance(scenes, list) or not scenes:
        raise SceneFrameRangeError('Storyboard must contain at least one scene.')
    if isinstance(fps, bool) or not isinstance(fps, int) or fps <= 0:
        raise SceneFrameRangeError('FPS must be a positive integer.')

    result = {}
    elapsed = 0.0
    start_frame = 0
    for scene in scenes:
        if not isinstance(scene, dict):
            raise SceneFrameRangeError('Every storyboard scene must be an object.')
        scene_id = scene.get('id')
        duration = scene.get('duration')
        if not isinstance(scene_id, str) or not scene_id or scene_id in result:
            raise SceneFrameRangeError('Scene IDs must be nonempty and unique.')
        if (isinstance(duration, bool) or not isinstance(duration, (int, float))
                or not math.isfinite(duration) or duration <= 0):
            raise SceneFrameRangeError(f"Scene '{scene_id}' must have a finite positive duration.")

        elapsed += float(duration)
        end_frame = _frame_boundary(elapsed, fps)
        if end_frame <= start_frame:
            raise SceneFrameRangeError(f"Scene '{scene_id}' is shorter than one frame at {fps} FPS.")
        result[scene_id] = {
            'start_frame': start_frame,
            'end_frame': end_frame,
            'scene_duration': float(duration),
            'rendered_duration': (end_frame - start_frame) / fps,
        }
        start_frame = end_frame

    return result


def storyboard_fingerprint(story: dict) -> str:
    canonical = json.dumps(story, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)
    return hashlib.sha256(canonical.encode('utf-8')).hexdigest()


def audio_trim_range(start_frame: int, end_frame: int, fps: int = 30) -> tuple[float, float]:
    if (isinstance(start_frame, bool) or not isinstance(start_frame, int)
            or isinstance(end_frame, bool) or not isinstance(end_frame, int)
            or start_frame < 0 or end_frame <= start_frame
            or isinstance(fps, bool) or not isinstance(fps, int) or fps <= 0):
        raise SceneFrameRangeError('Audio trim requires a valid half-open frame range and FPS.')
    return start_frame / fps, (end_frame - start_frame) / fps


def validate_audio_probe(details: dict, required_end_seconds: float, fps: int = 30) -> float:
    streams = details.get('streams') if isinstance(details, dict) else None
    if not isinstance(streams, list) or not streams or not isinstance(streams[0], dict) or streams[0].get('codec_type') != 'audio':
        raise ValueError('Generated soundtrack has no valid audio stream.')
    format_info = details.get('format')
    value = streams[0].get('duration') or (format_info.get('duration') if isinstance(format_info, dict) else None)
    try:
        duration = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError('Generated soundtrack has no valid duration.') from exc
    if not math.isfinite(duration) or duration + (1 / fps) < required_end_seconds:
        raise ValueError('Generated soundtrack does not cover the selected scene interval.')
    return duration
