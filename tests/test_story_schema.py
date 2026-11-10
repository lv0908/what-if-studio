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

from app.main import (StoryDocument, EpisodeRequest, validate_story, save_story_project,
                      get_story_project, update_story_project, StoryProjectRequest)
from unittest.mock import patch


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

    def test_v1_and_versionless_inputs_normalize_to_v2(self):
        for version in (1, None):
            data = self.load_example('humans-underwater.json')
            if version is None: data.pop('schema_version')
            else: data['schema_version'] = version
            story = validate_story(StoryDocument.model_validate(data))
            self.assertEqual(story.schema_version, 2)
            self.assertEqual(story.scenes[0].visual.props[0].kind, 'human')
            self.assertEqual(story.actors, [])

    def test_v2_contract_references_and_event_timing(self):
        data = self.load_example('dinosaurs-returned.json')
        data['schema_version'] = 2
        data['actors'] = [{'id': 'rex', 'name': 'Rex', 'asset_id': 'dino-model'}]
        data['assets'] = [{'id': 'dino-model', 'type': 'model', 'uri': 'assets/rex.glb'}]
        data['scenes'][0]['actor_ids'] = ['rex']
        data['scenes'][0]['visual']['props'][0]['id'] = 'rex'
        data['scenes'][0]['events'] = [{'id': 'enter', 'type': 'enter', 'start': 2, 'duration': 3, 'actor_ids': ['rex'], 'to_position': [0, 0, -7]}]
        data['camera_tracks'] = [{'id': 'cam-main', 'scene_id': 'dino-jungle', 'keyframes': [{'time': 0, 'position': [0, 2, 12]}]}]
        data['transitions'] = [{'id': 'cut-one', 'from_scene_id': 'dino-jungle', 'to_scene_id': 'dino-city', 'type': 'fade', 'duration': 1}]
        data['lighting_cues'] = [{'id': 'sunrise', 'scene_id': 'dino-jungle', 'start': 0, 'duration': 5, 'settings': {'intensity': 2}}]
        data['audio_cues'] = [{'id': 'call', 'scene_id': 'dino-jungle', 'start': 1, 'duration': 2, 'asset_id': 'dino-model'}]
        self.assertEqual(validate_story(StoryDocument.model_validate(data)).schema_version, 2)
        bad_mutations = (
            lambda d: d.update(schema_version=3),
            lambda d: d.update(actors=[{'id': 'rex', 'name': 'Rex'}, {'id': 'rex', 'name': 'Duplicate'}]),
            lambda d: d.update(assets=[{'id': 'a', 'uri': 'assets/a.png'}], actors=[{'id': 'rex', 'name': 'Rex', 'asset_id': 'missing'}]),
            lambda d: d['scenes'][0].update(actor_ids=['missing']),
            lambda d: d['scenes'][0].update(events=[{'id': 'late', 'type': 'actor.enter', 'start': 9, 'duration': 2}]),
            lambda d: d.update(camera_tracks=[{'id': 'cam', 'scene_id': 'missing', 'keyframes': [{'time': 0}]}]),
        )
        for mutate in bad_mutations:
            with self.subTest(mutate=mutate):
                invalid = self.load_example('dinosaurs-returned.json'); invalid['schema_version'] = 2; mutate(invalid)
                with self.assertRaises((ValidationError, ValueError)):
                    StoryDocument.model_validate(invalid)

    def test_duplicate_scenes_and_missing_required_fields_are_rejected(self):
        duplicate = self.load_example('dinosaurs-returned.json')
        duplicate['scenes'][1]['id'] = duplicate['scenes'][0]['id']
        with self.assertRaises((ValidationError, ValueError)):
            StoryDocument.model_validate(duplicate)
        missing = self.load_example('dinosaurs-returned.json')
        del missing['scenes'][0]['duration']
        with self.assertRaises(ValidationError):
            StoryDocument.model_validate(missing)

    def test_event_instances_actions_and_conflicts_are_validated(self):
        valid = self.load_example('dinosaurs-returned.json')
        valid['scenes'][0]['visual']['props'][0]['id'] = 'dino'
        valid['scenes'][0]['visual']['props'][1]['id'] = 'human'
        valid['scenes'][0]['events'] = [
            {'id': 'dino-move', 'type': 'move', 'actor_id': 'dino', 'start': 0, 'duration': 3, 'to_position': [4, 0, -7]},
            {'id': 'human-turn', 'type': 'turn', 'actor_id': 'human', 'start': 0, 'duration': 3, 'to_rotation': [0, 1, 0]},
        ]
        self.assertEqual(StoryDocument.model_validate(valid).schema_version, 2)
        invalid_cases = []
        unsupported = self.load_example('dinosaurs-returned.json')
        unsupported['scenes'][0]['visual']['props'][0]['id'] = 'dino'
        unsupported['scenes'][0]['events'] = [{'id': 'bad-action', 'type': 'dance', 'actor_id': 'dino', 'start': 0, 'duration': 1}]
        invalid_cases.append(unsupported)
        missing_end = self.load_example('dinosaurs-returned.json')
        missing_end['scenes'][0]['visual']['props'][0]['id'] = 'dino'
        missing_end['scenes'][0]['events'] = [{'id': 'bad-move', 'type': 'move', 'actor_id': 'dino', 'start': 0, 'duration': 1}]
        invalid_cases.append(missing_end)
        conflict = self.load_example('dinosaurs-returned.json')
        conflict['scenes'][0]['visual']['props'][0]['id'] = 'dino'
        conflict['scenes'][0]['events'] = [
            {'id': 'move-a', 'type': 'move', 'actor_id': 'dino', 'start': 0, 'duration': 2, 'to_position': [1, 0, 0]},
            {'id': 'move-b', 'type': 'walk', 'actor_id': 'dino', 'start': 1, 'duration': 2, 'to_position': [2, 0, 0]},
        ]
        invalid_cases.append(conflict)
        unknown_target = self.load_example('dinosaurs-returned.json')
        unknown_target['scenes'][0]['visual']['props'][0]['id'] = 'dino'
        unknown_target['scenes'][0]['events'] = [{'id': 'bad-follow', 'type': 'follow', 'actor_id': 'dino', 'target_id': 'missing', 'start': 0, 'duration': 1}]
        invalid_cases.append(unknown_target)
        for data in invalid_cases:
            with self.subTest(data=data['scenes'][0]['events']):
                with self.assertRaises((ValidationError, ValueError)):
                    StoryDocument.model_validate(data)

    def test_v1_migration_keeps_legacy_props_valid_with_new_instance_defaults(self):
        data = self.load_example('dinosaurs-returned.json')
        data['schema_version'] = 1
        story = StoryDocument.model_validate(data)
        self.assertEqual(story.schema_version, 2)
        self.assertIsNone(story.scenes[0].visual.props[0].id)
        self.assertTrue(story.scenes[0].visual.props[0].visible)

    def test_empty_story_metadata_is_still_rejected_by_backend_validation(self):
        data = self.load_example('dinosaurs-returned.json')
        for field in ('tone', 'audience', 'narrative_style'):
            data[field] = ''
        with self.assertRaises(ValidationError) as raised:
            StoryDocument.model_validate(data)
        invalid_fields = {error['loc'][0] for error in raised.exception.errors()}
        self.assertTrue({'tone', 'audience', 'narrative_style'}.issubset(invalid_fields))

    def test_save_load_edit_round_trip_and_render_api_compatibility(self):
        from tempfile import TemporaryDirectory
        with TemporaryDirectory(prefix='story-contract-roundtrip-') as directory:
            with patch('app.main.STORY_PROJECTS', Path(directory)):
                story = StoryDocument.model_validate(self.load_example('dinosaurs-returned.json'))
                saved = save_story_project(StoryProjectRequest(story=story))
                project_id = saved['id']
                self.assertEqual(saved['story']['schema_version'], 2)
                loaded = get_story_project(project_id)
                self.assertEqual(loaded['story']['title'], story.title)
                edited = self.load_example('dinosaurs-returned.json'); edited['title'] = 'Edited title'
                updated = update_story_project(project_id, StoryProjectRequest(story=StoryDocument.model_validate(edited)))
                self.assertEqual(updated['story']['title'], 'Edited title')
                # Existing render request fields and a legacy storyboard remain accepted.
                render = EpisodeRequest.model_validate({'topic': story.topic, 'duration': story.duration, 'story': self.load_example('dinosaurs-returned.json')})
                self.assertEqual(validate_story(render.story).schema_version, 2)

if __name__ == '__main__':
    unittest.main()
