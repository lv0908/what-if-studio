import json
import os
import tempfile
import unittest
from pathlib import Path

from pydantic import ValidationError
from fastapi import HTTPException

_runtime = tempfile.TemporaryDirectory(prefix='whatif-schema-tests-')
os.environ.setdefault('PROJECTS_DIR', str(Path(_runtime.name) / 'projects'))
os.environ.setdefault('STORY_PROJECTS_DIR', str(Path(_runtime.name) / 'story-projects'))
os.environ.setdefault('EXPORTS_DIR', str(Path(_runtime.name) / 'exports'))

from app.main import StoryDocument, validate_story


ROOT = Path(__file__).resolve().parents[1]


class StorySchemaTests(unittest.TestCase):
    def load_example(self, name):
        return json.loads((ROOT / 'examples' / name).read_text(encoding='utf-8'))

    def test_examples_validate_and_scene_durations_match(self):
        for name in ('dinosaurs-returned.json', 'humans-underwater.json'):
            with self.subTest(name=name):
                story = validate_story(StoryDocument.model_validate(self.load_example(name)))
                self.assertAlmostEqual(sum(scene.duration for scene in story.scenes), story.duration)
                self.assertTrue(all(scene.visual.props for scene in story.scenes))

    def test_optional_visual_properties_receive_defaults(self):
        data = self.load_example('dinosaurs-returned.json')
        del data['scenes'][0]['visual']['fog_density']
        del data['scenes'][0]['visual']['camera_position']
        del data['scenes'][0]['visual']['props'][0]['scale']
        scene = StoryDocument.model_validate(data).scenes[0]
        self.assertEqual(scene.visual.fog_density, 0.012)
        self.assertEqual(scene.visual.camera_position, [0.0, 2.2, 12.0])
        self.assertEqual(scene.visual.props[0].scale, [1.0, 1.0, 1.0])

    def test_rejects_unknown_visual_fields_and_unsupported_presets(self):
        for mutate in (
            lambda visual: visual.update(script='alert(1)'),
            lambda visual: visual.update(environment='volcanic_moon'),
        ):
            with self.subTest(mutate=mutate):
                data = self.load_example('dinosaurs-returned.json')
                mutate(data['scenes'][0]['visual'])
                with self.assertRaises(ValidationError):
                    StoryDocument.model_validate(data)

    def test_rejects_unknown_props_and_invalid_transforms(self):
        mutations = (
            lambda prop: prop.update(kind='dragon'),
            lambda prop: prop.update(position=[0, 1]),
            lambda prop: prop.update(scale=[0, 1, 1]),
            lambda prop: prop.update(color='red'),
            lambda prop: prop.update(motion='teleport'),
        )
        for mutate in mutations:
            with self.subTest(mutate=mutate):
                data = self.load_example('dinosaurs-returned.json')
                mutate(data['scenes'][0]['visual']['props'][0])
                with self.assertRaises(ValidationError):
                    StoryDocument.model_validate(data)

    def test_rejects_nonfinite_and_out_of_range_camera_vectors(self):
        for field, vector in (('camera_position', [float('nan'), 0, 0]), ('camera_look_at', [0, 0, 501])):
            with self.subTest(field=field):
                data = self.load_example('dinosaurs-returned.json')
                data['scenes'][0]['visual'][field] = vector
                with self.assertRaises(ValidationError):
                    StoryDocument.model_validate(data)

    def test_rejects_duration_mismatch_and_scene_extra_fields(self):
        data = self.load_example('dinosaurs-returned.json')
        data['scenes'][0]['duration'] = 9
        with self.assertRaises(HTTPException):
            validate_story(StoryDocument.model_validate(data))
        data = self.load_example('dinosaurs-returned.json')
        data['scenes'][0]['visual']['props'][0]['onUpdate'] = 'code'
        with self.assertRaises(ValidationError):
            StoryDocument.model_validate(data)

if __name__ == '__main__':
    unittest.main()
