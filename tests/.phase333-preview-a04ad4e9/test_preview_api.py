import json
import os
from pathlib import Path
import time
import unittest

from fastapi.testclient import TestClient

TEMP_ROOT = Path(__file__).resolve().parent
WORKSPACE = TEMP_ROOT.parents[1]
os.environ['PROJECTS_DIR'] = str(TEMP_ROOT / 'runtime' / 'projects')
os.environ['STORY_PROJECTS_DIR'] = str(TEMP_ROOT / 'runtime' / 'story-projects')
os.environ['EXPORTS_DIR'] = str(TEMP_ROOT / 'runtime' / 'exports')
os.environ['JOBS_DIR'] = str(TEMP_ROOT / 'runtime' / 'jobs')

from app.main import app, PREVIEW_SESSIONS, StoryDocument


class ScenePreviewApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.story = json.loads((TEMP_ROOT / 'storyboard.json').read_text(encoding='utf-8'))
        cls.client_context = TestClient(app)
        cls.client = cls.client_context.__enter__()

    @classmethod
    def tearDownClass(cls):
        cls.client_context.__exit__(None, None, None)

    def create(self):
        return self.client.post('/api/scene-previews', json={'story': self.story})

    def test_create_preview_returns_http_201(self):
        response = self.create()
        self.assertEqual(response.status_code, 201, response.text)

    def test_returned_token_retrieves_the_same_storyboard(self):
        created = self.create()
        self.assertIn(created.status_code, (200, 201), created.text)
        token = created.json()['preview_id']
        response = self.client.post('/api/scene-previews/story', json={'preview_id': token})
        self.assertEqual(response.status_code, 200, response.text)
        expected = StoryDocument.model_validate(self.story).model_dump(mode='json')
        self.assertEqual(response.json(), expected)

    def test_unknown_token_returns_http_404(self):
        response = self.client.post('/api/scene-previews/story', json={'preview_id': 'Z' * 43})
        self.assertEqual(response.status_code, 404, response.text)

    def test_expired_token_returns_http_404(self):
        created = self.create()
        self.assertIn(created.status_code, (200, 201), created.text)
        token = created.json()['preview_id']
        PREVIEW_SESSIONS._sessions[token]['expires_at'] = time.monotonic() - 1
        response = self.client.post('/api/scene-previews/story', json={'preview_id': token})
        self.assertEqual(response.status_code, 404, response.text)


if __name__ == '__main__':
    unittest.main(verbosity=2)
