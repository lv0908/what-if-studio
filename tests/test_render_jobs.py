import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from app.render_jobs import (
    JOB_ACTIVE,
    JOB_TERMINAL,
    JobPersistenceError,
    RenderJobRegistry,
    RenderJobStore,
    publish_file_without_overwrite,
    rollback_published_file,
)


API_FIELDS = {
    'id', 'topic', 'duration', 'status', 'progress', 'message', 'stage',
    'completed_frames', 'total_frames', 'frame_progress_kind',
}


def make_job(job_id='0123456789ab', **updates):
    job = {
        'id': job_id,
        'topic': 'Render persistence test',
        'duration': 30,
        'status': 'queued',
        'progress': 0,
        'message': 'Queued',
        'stage': 'queued',
        'completed_frames': 0,
        'total_frames': 900,
        'frame_progress_kind': 'captured_and_submitted',
    }
    job.update(updates)
    return job


def make_rendering(registry, job_id):
    assert registry.transition(job_id, 'preparing', {'stage': 'preparing'})
    assert registry.transition(job_id, 'soundtrack', {'stage': 'soundtrack'})
    assert registry.transition(job_id, 'rendering', {'stage': 'rendering'})


def progress_line(completed, total=900):
    return 'WHATIF_PROGRESS ' + json.dumps({
        'event': 'render_progress', 'stage': 'rendering', 'frame_kind': 'captured',
        'completed_frames': completed, 'total_frames': total,
    })


class FakeClock:
    def __init__(self): self.value = 0.0
    def __call__(self): return self.value
    def advance(self, seconds): self.value += seconds


class RenderJobPersistenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(
            prefix='.phase332-render-jobs-', dir=Path(__file__).resolve().parents[1],
        )
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name) / 'jobs'
        self.store = RenderJobStore(self.directory)
        self.registry = RenderJobRegistry(self.store)

    def test_new_job_is_persisted_before_worker_starts_and_api_fields_are_exact(self):
        starter = Mock()
        response = self.registry.create_and_start(make_job(), starter)
        starter.assert_called_once_with()
        self.assertEqual(set(response), API_FIELDS)
        saved = json.loads((self.directory / '0123456789ab.json').read_text(encoding='utf-8'))
        self.assertEqual(saved['job'], response)
        self.assertEqual(saved['job']['status'], 'queued')
        self.assertIn('created_at', saved)
        self.assertIn('updated_at', saved)

    def test_failed_initial_persistence_does_not_publish_or_start_a_worker(self):
        starter = Mock()
        with patch.object(self.store, 'save', side_effect=JobPersistenceError('disk unavailable')):
            with self.assertRaises(JobPersistenceError):
                self.registry.create_and_start(make_job(), starter)
        starter.assert_not_called()
        self.assertIsNone(self.registry.snapshot('0123456789ab'))
        self.assertFalse((self.directory / '0123456789ab.json').exists())

    def test_reload_preserves_public_fields_and_telemetry(self):
        job = make_job()
        registry = RenderJobRegistry(self.store, persist_interval=0)
        registry.create(job)
        make_rendering(registry, job['id'])
        registry.update_progress_line(job['id'], progress_line(321))
        reloaded = RenderJobRegistry(self.store)
        reloaded.recover()
        restored = reloaded.snapshot(job['id'])
        self.assertEqual(restored['completed_frames'], 321)
        self.assertEqual(restored['total_frames'], 900)
        self.assertEqual(restored['frame_progress_kind'], 'captured_and_submitted')
        self.assertTrue(API_FIELDS.issubset(restored))

    def test_recovery_interrupts_every_current_active_status_and_never_resumes(self):
        self.store.initialize()
        for index, status in enumerate(sorted(JOB_ACTIVE)):
            job_id = f'{index:012x}'
            job = make_job(job_id, status=status, stage=status, progress=27, completed_frames=243)
            record = {
                'schema_version': 1, 'revision': 2, 'job': job,
                'created_at': '2026-01-01T00:00:00Z', 'updated_at': '2026-01-01T00:01:00Z',
                'finished_at': None, 'interrupted_at': None, 'stop_requested': False,
                'error_detail': None, 'output_reference': None,
            }
            self.store.save(record, create=True)
        restored = RenderJobRegistry(self.store)
        restored.recover()
        self.assertEqual(len(restored.processes), 0)
        self.assertEqual(len(restored.jobs), len(JOB_ACTIVE))
        for job in restored.list_snapshots():
            self.assertEqual(job['status'], 'interrupted')
            self.assertEqual(job['progress'], 27)
            self.assertEqual(job['completed_frames'], 243)
            self.assertIn(job['stage'], JOB_ACTIVE)
            self.assertIn('stopped while this job was active', job['message'])
            persisted = json.loads((self.directory / f"{job['id']}.json").read_text(encoding='utf-8'))
            self.assertIsNotNone(persisted['interrupted_at'])
            self.assertEqual(persisted['job']['status'], 'interrupted')

    def test_terminal_states_and_completed_video_reference_survive_recovery(self):
        self.store.initialize()
        statuses = sorted(JOB_TERMINAL)
        for index, status in enumerate(statuses):
            job_id = f'{index + 10:012x}'
            job = make_job(job_id, status=status, stage='complete' if status == 'completed' else 'failed')
            if status == 'completed': job['video'] = f'/api/episodes/{job_id}/video'
            record = {
                'schema_version': 1, 'revision': 1, 'job': job,
                'created_at': '2026-01-01T00:00:00Z', 'updated_at': '2026-01-01T00:01:00Z',
                'finished_at': '2026-01-01T00:01:00Z', 'interrupted_at': None,
                'stop_requested': False, 'error_detail': None, 'output_reference': job.get('video'),
            }
            self.store.save(record, create=True)
        recovered = RenderJobRegistry(self.store)
        recovered.recover()
        for job in recovered.list_snapshots():
            self.assertIn(job['status'], JOB_TERMINAL)
        completed = next(job for job in recovered.list_snapshots() if job['status'] == 'completed')
        self.assertEqual(completed['video'], f"/api/episodes/{completed['id']}/video")

    def test_malformed_metadata_is_skipped_without_rewriting_it(self):
        self.store.initialize()
        malformed = self.directory / 'aaaaaaaaaaaa.json'
        malformed.write_text('{broken', encoding='utf-8')
        original = malformed.read_bytes()
        self.assertEqual(RenderJobRegistry(self.store).recover(), [])
        self.assertEqual(malformed.read_bytes(), original)

    def test_semantically_invalid_metadata_is_skipped_without_rewriting_it(self):
        self.store.initialize()
        malformed = self.directory / 'aaaaaaaaaaaa.json'
        record = {
            'schema_version': 1, 'revision': 1, 'job': make_job('aaaaaaaaaaaa', progress=float('nan')),
            'created_at': '2026-01-01T00:00:00Z', 'updated_at': '2026-01-01T00:00:00Z',
            'finished_at': None, 'interrupted_at': None, 'stop_requested': False,
            'error_detail': None, 'output_reference': None,
        }
        malformed.write_text(json.dumps(record), encoding='utf-8')
        original = malformed.read_bytes()
        self.assertEqual(RenderJobRegistry(self.store).recover(), [])
        self.assertEqual(malformed.read_bytes(), original)

    def test_overflowing_numeric_metadata_is_skipped_without_rewriting_it(self):
        self.store.initialize()
        malformed = self.directory / 'aaaaaaaaaaaa.json'
        record = {
            'schema_version': 1, 'revision': 1,
            'job': make_job('aaaaaaaaaaaa', duration=10 ** 500),
            'created_at': '2026-01-01T00:00:00Z', 'updated_at': '2026-01-01T00:00:00Z',
            'finished_at': None, 'interrupted_at': None, 'stop_requested': False,
            'error_detail': None, 'output_reference': None,
        }
        malformed.write_text(json.dumps(record), encoding='utf-8')
        original = malformed.read_bytes()
        self.assertEqual(RenderJobRegistry(self.store).recover(), [])
        self.assertEqual(malformed.read_bytes(), original)

    def test_missing_metadata_is_not_inferred_or_created(self):
        self.assertEqual(self.registry.recover(), [])
        self.assertEqual(list(self.directory.glob('*.json')), [])

    def test_atomic_replace_failure_preserves_previous_record_and_cleans_temp(self):
        self.registry.create(make_job())
        target = self.directory / '0123456789ab.json'
        original = target.read_bytes()
        changed = json.loads(original)
        changed['job']['message'] = 'must not replace prior state'
        with patch('app.render_jobs.os.replace', side_effect=OSError('replace failed')):
            with self.assertRaises(JobPersistenceError):
                self.store.save(changed)
        self.assertEqual(target.read_bytes(), original)
        self.assertEqual(list(self.directory.glob('*.tmp')), [])

    def test_output_publication_is_staged_atomic_and_never_overwrites(self):
        self.store.initialize()
        source = self.directory / 'source.mp4'
        destination = self.directory / 'published.mp4'
        source.write_bytes(b'new-test-output')
        temporary = publish_file_without_overwrite(source, destination)
        self.assertEqual(destination.read_bytes(), b'new-test-output')
        self.assertTrue(temporary.exists())
        with self.assertRaises(FileExistsError):
            publish_file_without_overwrite(source, destination)
        self.assertEqual(destination.read_bytes(), b'new-test-output')
        rollback_published_file(temporary, destination)
        self.assertFalse(destination.exists())
        temporary.unlink(missing_ok=True)

    def test_progress_persistence_is_throttled_then_flushes_latest_revision(self):
        clock = FakeClock()
        registry = RenderJobRegistry(self.store, clock=clock, persist_interval=1.0)
        registry.create(make_job())
        make_rendering(registry, '0123456789ab')
        target = self.directory / '0123456789ab.json'
        before = json.loads(target.read_text(encoding='utf-8'))
        clock.advance(0.25)
        self.assertTrue(registry.update_progress_line('0123456789ab', progress_line(30)))
        still_durable = json.loads(target.read_text(encoding='utf-8'))
        self.assertEqual(still_durable['job']['completed_frames'], before['job']['completed_frames'])
        clock.advance(1.0)
        self.assertTrue(registry.update_progress_line('0123456789ab', progress_line(60)))
        durable = json.loads(target.read_text(encoding='utf-8'))
        self.assertEqual(durable['job']['completed_frames'], 60)
        self.assertEqual(durable['revision'], registry.records['0123456789ab']['revision'])

    def test_stop_racing_with_progress_serializes_and_blocks_late_progress(self):
        job_id = '0123456789ab'
        self.registry.create(make_job())
        make_rendering(self.registry, job_id)
        process = object()
        self.assertTrue(self.registry.register_process(job_id, process))
        barrier = threading.Barrier(3)
        outcomes = []

        def progress():
            barrier.wait()
            outcomes.append(self.registry.update_progress_line(job_id, progress_line(300)))

        def stop():
            barrier.wait()
            outcomes.append(self.registry.request_stop(job_id))

        threads = [threading.Thread(target=progress), threading.Thread(target=stop)]
        for thread in threads: thread.start()
        barrier.wait()
        for thread in threads: thread.join(timeout=2)
        self.assertTrue(all(not thread.is_alive() for thread in threads))
        before = self.registry.snapshot(job_id)['completed_frames']
        self.assertFalse(self.registry.update_progress_line(job_id, progress_line(600)))
        self.assertEqual(self.registry.snapshot(job_id)['completed_frames'], before)
        self.assertTrue(self.registry.records[job_id]['stop_requested'])

    def test_stop_racing_with_worker_completion_has_one_terminal_winner(self):
        job_id = '0123456789ab'
        self.registry.create(make_job())
        make_rendering(self.registry, job_id)
        self.registry.register_process(job_id, object())
        publish_entered = threading.Event()
        release_publish = threading.Event()
        published = []
        results = []

        def publish():
            publish_entered.set()
            release_publish.wait(timeout=2)
            published.append(True)
            return f'/api/episodes/{job_id}/video'

        worker = threading.Thread(target=lambda: results.append(self.registry.finish_success(job_id, publish)))
        worker.start()
        self.assertTrue(publish_entered.wait(timeout=2))
        stopper = threading.Thread(target=lambda: results.append(self.registry.request_stop(job_id)))
        stopper.start()
        release_publish.set()
        worker.join(timeout=2); stopper.join(timeout=2)
        self.assertFalse(worker.is_alive() or stopper.is_alive())
        self.assertEqual(self.registry.snapshot(job_id)['status'], 'completed')
        self.assertEqual(self.registry.snapshot(job_id)['video'], f'/api/episodes/{job_id}/video')
        self.assertEqual(published, [True])

    def test_stop_before_completion_prevents_export_publication(self):
        job_id = '0123456789ab'
        self.registry.create(make_job())
        make_rendering(self.registry, job_id)
        self.registry.register_process(job_id, object())
        self.registry.request_stop(job_id)
        publish = Mock(return_value='must-not-publish')
        self.assertFalse(self.registry.finish_success(job_id, publish))
        publish.assert_not_called()
        self.assertEqual(self.registry.snapshot(job_id)['status'], 'stopped')

    def test_completion_persistence_failure_rolls_back_newly_published_output(self):
        job_id = '0123456789ab'
        self.registry.create(make_job())
        make_rendering(self.registry, job_id)
        export = self.directory / 'isolated-export.mp4'
        original_save = self.store.save

        def fail_completed_record(record, **kwargs):
            if record['job']['status'] == 'completed':
                raise JobPersistenceError('simulated completion persistence failure')
            return original_save(record, **kwargs)

        def publish():
            source = self.directory / 'source.mp4'
            source.write_bytes(b'test-only-output')
            temporary = publish_file_without_overwrite(source, export)
            publication_temp.append(temporary)
            return f'/api/episodes/{job_id}/video'

        def rollback():
            rollback_published_file(publication_temp[0], export)

        publication_temp = []

        with patch.object(self.store, 'save', side_effect=fail_completed_record):
            with self.assertRaises(JobPersistenceError):
                self.registry.finish_success(job_id, publish, rollback)

        self.assertFalse(export.exists())
        publication_temp[0].unlink(missing_ok=True)
        self.assertEqual(self.registry.snapshot(job_id)['status'], 'rendering')
        durable = json.loads((self.directory / f'{job_id}.json').read_text(encoding='utf-8'))
        self.assertEqual(durable['job']['status'], 'rendering')

    def test_duplicate_stop_requests_are_idempotent(self):
        job_id = '0123456789ab'
        self.registry.create(make_job())
        make_rendering(self.registry, job_id)
        self.registry.register_process(job_id, object())
        first = self.registry.request_stop(job_id)
        revision = self.registry.records[job_id]['revision']
        second = self.registry.request_stop(job_id)
        self.assertEqual(second, first)
        self.assertEqual(self.registry.records[job_id]['revision'], revision)
        self.assertTrue(self.registry.stop_events[job_id].is_set())

    def test_late_progress_cannot_change_any_terminal_state(self):
        for index, status in enumerate(sorted(JOB_TERMINAL)):
            job_id = f'{index + 20:012x}'
            registry = RenderJobRegistry(RenderJobStore(self.directory / status))
            registry.create(make_job(job_id))
            if status == 'interrupted':
                make_rendering(registry, job_id)
                registry = RenderJobRegistry(registry.store)
                registry.recover()
            elif status == 'stopped':
                registry.request_stop(job_id)
            elif status == 'failed':
                registry.finish_failure(job_id, 'expected failure')
            else:
                make_rendering(registry, job_id)
                registry.finish_success(job_id, lambda: f'/api/episodes/{job_id}/video')
            before = registry.snapshot(job_id)
            self.assertFalse(registry.update_progress_line(job_id, progress_line(500)))
            self.assertFalse(registry.transition(job_id, 'failed', {'message': 'late failure'}))
            self.assertEqual(registry.snapshot(job_id), before)

    def test_stop_and_failure_states_are_persisted(self):
        stopped_id = '0123456789ab'
        failed_id = '1123456789ab'
        self.registry.create(make_job(stopped_id))
        self.registry.request_stop(stopped_id)
        self.registry.create(make_job(failed_id))
        self.registry.finish_failure(failed_id, 'test failure')
        restored = RenderJobRegistry(self.store)
        restored.recover()
        self.assertEqual(restored.snapshot(stopped_id)['status'], 'stopped')
        self.assertEqual(restored.snapshot(failed_id)['status'], 'failed')
        self.assertEqual(restored.records[failed_id]['error_detail']['message'], 'test failure')


if __name__ == '__main__':
    unittest.main()
