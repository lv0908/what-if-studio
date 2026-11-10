"""Bounded, in-memory preview storyboard sessions."""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
import re
import secrets
from threading import Lock
import time


class PreviewCapacityError(RuntimeError):
    pass


class PreviewStoryTooLarge(ValueError):
    pass


class ScenePreviewSessions:
    TOKEN_PATTERN = re.compile(r'^[A-Za-z0-9_-]{32,128}$')

    def __init__(self, *, max_sessions=32, ttl_seconds=900, max_story_bytes=2 * 1024 * 1024, clock=time.monotonic):
        self.max_sessions = max_sessions
        self.ttl_seconds = ttl_seconds
        self.max_story_bytes = max_story_bytes
        self.clock = clock
        self._sessions = {}
        self._lock = Lock()

    def _purge_expired_locked(self, now):
        expired = [token for token, session in self._sessions.items() if session['expires_at'] <= now]
        for token in expired:
            del self._sessions[token]

    def create(self, story):
        serialized = json.dumps(story, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')
        if len(serialized) > self.max_story_bytes:
            raise PreviewStoryTooLarge('Preview storyboard exceeds the configured size limit.')
        now = self.clock()
        with self._lock:
            self._purge_expired_locked(now)
            if len(self._sessions) >= self.max_sessions:
                raise PreviewCapacityError('Preview capacity is full; wait for an existing preview to expire.')
            token = secrets.token_urlsafe(32)
            while token in self._sessions:
                token = secrets.token_urlsafe(32)
            expires_at = now + self.ttl_seconds
            self._sessions[token] = {'story': deepcopy(story), 'expires_at': expires_at}
        expires_utc = datetime.now(timezone.utc) + timedelta(seconds=self.ttl_seconds)
        return token, expires_utc.isoformat().replace('+00:00', 'Z')

    def get(self, token):
        if not isinstance(token, str) or not self.TOKEN_PATTERN.fullmatch(token):
            return None
        now = self.clock()
        with self._lock:
            self._purge_expired_locked(now)
            session = self._sessions.get(token)
            return deepcopy(session['story']) if session is not None else None
