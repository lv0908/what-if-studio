"""Persistent render-job records and serialized lifecycle mutations."""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import json
import logging
import math
import os
from pathlib import Path
import re
import shutil
import tempfile
from threading import Event, Lock, RLock
import time

from app.render_progress import apply_render_progress, parse_render_progress


JOB_ACTIVE = frozenset({'queued', 'preparing', 'soundtrack', 'rendering'})
JOB_TERMINAL = frozenset({'completed', 'failed', 'stopped', 'interrupted'})
JOB_STATUSES = JOB_ACTIVE | JOB_TERMINAL
JOB_TRANSITIONS = {
    'queued': frozenset({'preparing', 'stopped', 'failed', 'interrupted'}),
    'preparing': frozenset({'soundtrack', 'stopped', 'failed', 'interrupted'}),
    'soundtrack': frozenset({'rendering', 'stopped', 'failed', 'interrupted'}),
    'rendering': frozenset({'completed', 'stopped', 'failed', 'interrupted'}),
    'completed': frozenset(),
    'failed': frozenset(),
    'stopped': frozenset(),
    'interrupted': frozenset(),
}
JOB_ID_PATTERN = re.compile(r'^[a-f0-9]{12}$')
JOB_REQUIRED_FIELDS = frozenset({
    'id', 'topic', 'duration', 'status', 'progress', 'message', 'stage',
    'completed_frames', 'total_frames', 'frame_progress_kind',
})
_UNSET = object()


class JobPersistenceError(RuntimeError):
    """A job record could not be committed safely."""


def utc_now():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def publish_file_without_overwrite(source: str | Path, destination: str | Path) -> Path:
    """Stage beside destination, then atomically link it without replacing a file."""
    source = Path(source)
    destination = Path(destination)
    if not source.is_file():
        raise FileNotFoundError(f'Expected render output is missing: {source.name}')
    if destination.exists():
        raise FileExistsError(f'Render output already exists: {destination.name}')
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            prefix=f'.{destination.stem}.', suffix='.tmp', dir=destination.parent, delete=False,
        ) as staged:
            temporary = Path(staged.name)
        shutil.copy2(source, temporary)
        # Hard-link creation is atomic and fails if destination appeared meanwhile.
        os.link(temporary, destination)
        return temporary
    except Exception:
        if temporary is not None:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                logging.exception('Could not remove staged output %s', temporary.name)
        raise


def rollback_published_file(temporary: str | Path, destination: str | Path):
    """Remove destination only when it is still the same file published by us."""
    temporary = Path(temporary)
    destination = Path(destination)
    if temporary.exists() and destination.exists() and os.path.samefile(temporary, destination):
        destination.unlink()


class RenderJobStore:
    """Store one versioned JSON envelope per job without touching project files."""

    def __init__(self, directory: str | Path):
        self.directory = Path(directory)

    def initialize(self):
        self.directory.mkdir(parents=True, exist_ok=True)

    def path_for(self, job_id: str) -> Path:
        if not JOB_ID_PATTERN.fullmatch(job_id):
            raise ValueError('Invalid render job ID.')
        return self.directory / f'{job_id}.json'

    def save(self, record: dict, *, create: bool = False):
        try:
            self.initialize()
            job_id = record['job']['id']
            target = self.path_for(job_id)
        except Exception as exc:
            raise JobPersistenceError('Could not initialize render-job metadata storage.') from exc
        if create and target.exists():
            raise FileExistsError(f'Render job metadata already exists for {job_id}.')
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(
                mode='w', encoding='utf-8', newline='\n',
                prefix=f'.{job_id}.', suffix='.tmp', dir=self.directory,
                delete=False,
            ) as stream:
                temporary = Path(stream.name)
                json.dump(record, stream, ensure_ascii=False, separators=(',', ':'))
                stream.write('\n')
                stream.flush()
                os.fsync(stream.fileno())
            if create and target.exists():
                raise FileExistsError(f'Render job metadata already exists for {job_id}.')
            os.replace(temporary, target)
            temporary = None
            self._fsync_directory()
        except Exception as exc:
            if temporary is not None:
                try:
                    temporary.unlink(missing_ok=True)
                except OSError:
                    logging.exception('Could not remove temporary metadata for job %s', job_id)
            if isinstance(exc, FileExistsError):
                raise
            raise JobPersistenceError(f'Could not persist render job {job_id}.') from exc

    def load_records(self):
        """Load valid metadata files; malformed and temporary files are left untouched."""
        self.initialize()
        records = []
        for path in sorted(self.directory.glob('*.json')):
            if not JOB_ID_PATTERN.fullmatch(path.stem):
                logging.warning('Ignoring render-job record with invalid filename: %s', path.name)
                continue
            try:
                record = json.loads(path.read_text(encoding='utf-8'))
                self._validate_record(record, path.stem)
            except (OSError, UnicodeError, ValueError, TypeError, KeyError, OverflowError) as exc:
                logging.warning('Ignoring malformed render-job record %s: %s', path.name, exc)
                continue
            records.append(record)
        return records

    @staticmethod
    def _validate_record(record, filename_id):
        if not isinstance(record, dict) or record.get('schema_version') != 1:
            raise ValueError('Unsupported metadata record version.')
        if (isinstance(record.get('revision'), bool) or not isinstance(record.get('revision'), int)
                or record['revision'] < 1):
            raise ValueError('Invalid metadata revision.')
        job = record.get('job')
        if not isinstance(job, dict) or not JOB_REQUIRED_FIELDS.issubset(job):
            raise ValueError('Missing API job fields.')
        if job.get('id') != filename_id or job.get('status') not in JOB_STATUSES:
            raise ValueError('Job ID or status is invalid.')
        if not isinstance(job.get('topic'), str) or not isinstance(job.get('message'), str):
            raise ValueError('Invalid topic or message.')
        duration = job.get('duration')
        progress = job.get('progress')
        if (isinstance(duration, bool) or not isinstance(duration, (int, float))
                or not math.isfinite(duration) or duration <= 0):
            raise ValueError('Invalid job duration.')
        if (isinstance(progress, bool) or not isinstance(progress, (int, float))
                or not math.isfinite(progress) or not 0 <= progress <= 100):
            raise ValueError('Invalid job progress.')
        if not isinstance(job.get('stage'), str) or not isinstance(job.get('frame_progress_kind'), str):
            raise ValueError('Invalid job stage or frame-progress kind.')
        completed = job.get('completed_frames')
        total = job.get('total_frames')
        if (isinstance(completed, bool) or not isinstance(completed, int) or completed < 0
                or isinstance(total, bool) or not isinstance(total, int) or total <= 0
                or completed > total):
            raise ValueError('Invalid job frame counts.')
        if job.get('video') is not None and not isinstance(job.get('video'), str):
            raise ValueError('Invalid video reference.')
        if not isinstance(record.get('stop_requested'), bool):
            raise ValueError('Invalid stop-request marker.')

    def _fsync_directory(self):
        """Best-effort directory fsync after replace where the platform supports it."""
        flags = os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0)
        try:
            descriptor = os.open(self.directory, flags)
        except (OSError, TypeError):
            return
        try:
            os.fsync(descriptor)
        except OSError:
            # Some supported filesystems/platforms do not allow directory fsync.
            pass
        finally:
            os.close(descriptor)


class RenderJobRegistry:
    """Canonical in-memory jobs with serialized, terminal-safe mutations."""

    def __init__(self, store: RenderJobStore, *, clock=time.monotonic, persist_interval=1.0):
        self.store = store
        self.clock = clock
        self.persist_interval = persist_interval
        self.jobs: dict[str, dict] = {}
        self.records: dict[str, dict] = {}
        self.stop_events: dict[str, Event] = {}
        self.processes: dict[str, object] = {}
        self._job_locks: dict[str, RLock] = {}
        self._last_persist: dict[str, float] = {}
        self._guard = RLock()

    def _lock_for(self, job_id):
        with self._guard:
            return self._job_locks.setdefault(job_id, RLock())

    def create(self, job: dict):
        job_id = job.get('id')
        if not isinstance(job_id, str) or not JOB_ID_PATTERN.fullmatch(job_id):
            raise ValueError('Invalid render job ID.')
        if not JOB_REQUIRED_FIELDS.issubset(job) or job.get('status') != 'queued':
            raise ValueError('New render jobs must contain the compatible queued API fields.')
        record = {
            'schema_version': 1,
            'revision': 1,
            'job': deepcopy(job),
            'created_at': utc_now(),
            'updated_at': utc_now(),
            'finished_at': None,
            'interrupted_at': None,
            'stop_requested': False,
            'error_detail': None,
            'output_reference': job.get('video'),
        }
        with self._guard:
            if job_id in self.records or self.store.path_for(job_id).exists():
                raise FileExistsError(f'Render job ID {job_id} is already in use.')
            # Durable creation precedes registry publication and worker startup.
            self.store.save(record, create=True)
            self.records[job_id] = record
            self.jobs[job_id] = deepcopy(record['job'])
            self.stop_events[job_id] = Event()
            self._job_locks[job_id] = RLock()
            self._last_persist[job_id] = self.clock()
        return self.snapshot(job_id)

    def create_and_start(self, job: dict, starter):
        snapshot = self.create(job)
        starter()
        return snapshot

    def recover(self):
        """Restore records and mark every active record interrupted; never start workers."""
        self.store.initialize()
        loaded = self.store.load_records()
        for record in loaded:
            job_id = record['job']['id']
            lock = self._lock_for(job_id)
            with lock:
                restored = deepcopy(record)
                if restored['job']['status'] in JOB_ACTIVE:
                    restored['job']['status'] = 'interrupted'
                    restored['job']['message'] = 'Application stopped while this job was active.'
                    restored['interrupted_at'] = utc_now()
                    restored['finished_at'] = restored['interrupted_at']
                    restored['updated_at'] = restored['interrupted_at']
                    restored['revision'] += 1
                    try:
                        self.store.save(restored)
                    except JobPersistenceError:
                        # Do not serve an active-looking job when recovery could not persist.
                        raise
                with self._guard:
                    self.records[job_id] = restored
                    self.jobs[job_id] = deepcopy(restored['job'])
                    self.stop_events[job_id] = Event()
                    self._last_persist[job_id] = self.clock()
        return self.list_snapshots()

    def snapshot(self, job_id):
        with self._guard:
            if job_id not in self.records:
                return None
            lock = self._job_locks[job_id]
        with lock:
            with self._guard:
                job = self.jobs.get(job_id)
                return deepcopy(job) if job is not None else None

    def list_snapshots(self):
        with self._guard:
            ids = list(self.jobs)
        return [snapshot for job_id in ids if (snapshot := self.snapshot(job_id)) is not None]

    def _commit_locked(self, job_id, record, *, persist=True):
        if record['job']['status'] in JOB_TERMINAL and record.get('finished_at') is None:
            record['finished_at'] = utc_now()
        record['revision'] += 1
        record['updated_at'] = utc_now()
        if persist:
            self.store.save(record)
            self._last_persist[job_id] = self.clock()
        with self._guard:
            self.records[job_id] = record
            self.jobs[job_id] = deepcopy(record['job'])

    def update_fields(self, job_id, fields: dict, *, persist=True, allow_after_stop=False):
        if 'status' in fields:
            raise ValueError('Status changes must use the transition mechanism.')
        lock = self._lock_for(job_id)
        with lock:
            with self._guard:
                current = self.records.get(job_id)
                if current is None:
                    return None
                if current['job']['status'] in JOB_TERMINAL or (current['stop_requested'] and not allow_after_stop):
                    return deepcopy(current['job'])
                record = deepcopy(current)
            record['job'].update(fields)
            if record['job']['status'] in JOB_TERMINAL:
                return self.snapshot(job_id)
            self._commit_locked(job_id, record, persist=persist)
            return deepcopy(record['job'])

    def transition(self, job_id, status, fields=None, *, error_detail=_UNSET):
        lock = self._lock_for(job_id)
        with lock:
            with self._guard:
                current = self.records.get(job_id)
                if current is None:
                    return False
                old_status = current['job']['status']
                if old_status in JOB_TERMINAL:
                    return False
                if current['stop_requested'] and status not in ('stopped', 'failed'):
                    return False
                if status not in JOB_TRANSITIONS.get(old_status, frozenset()):
                    raise ValueError(f'Invalid render-job transition: {old_status} -> {status}.')
                record = deepcopy(current)
            record['job'].update(fields or {})
            record['job']['status'] = status
            if error_detail is not _UNSET:
                record['error_detail'] = error_detail
            if status == 'completed':
                record['output_reference'] = record['job'].get('video')
            self._commit_locked(job_id, record, persist=True)
            return True

    def update_progress_line(self, job_id, line):
        lock = self._lock_for(job_id)
        with lock:
            with self._guard:
                current = self.records.get(job_id)
                if current is None or current['job']['status'] in JOB_TERMINAL or current['stop_requested']:
                    return False
                if current['job']['status'] != 'rendering':
                    return False
                record = deepcopy(current)
            event = parse_render_progress(line, record['job']['total_frames'])
            if event is None:
                return False
            before = record['job']['completed_frames']
            updated = apply_render_progress(record['job'], event)
            if updated['completed_frames'] <= before:
                return False
            now = self.clock()
            should_persist = now - self._last_persist.get(job_id, 0) >= self.persist_interval
            self._commit_locked(job_id, record, persist=should_persist)
            return True

    def request_stop(self, job_id):
        lock = self._lock_for(job_id)
        with lock:
            with self._guard:
                current = self.records.get(job_id)
                if current is None:
                    return None
                if current['job']['status'] in JOB_TERMINAL:
                    return deepcopy(current['job'])
                if current['stop_requested']:
                    return deepcopy(current['job'])
                record = deepcopy(current)
                process = self.processes.get(job_id)
                event = self.stop_events[job_id]
            record['stop_requested'] = True
            if process is None:
                record['job'].update(status='stopped', message='Rendering stopped by user')
            self._commit_locked(job_id, record, persist=True)
            event.set()
            return deepcopy(record['job'])

    def acknowledge_stop(self, job_id):
        return self.transition(job_id, 'stopped', {'message': 'Rendering stopped by user'})

    def finish_failure(self, job_id, message):
        lock = self._lock_for(job_id)
        with lock:
            with self._guard:
                current = self.records.get(job_id)
                if current is None or current['job']['status'] in JOB_TERMINAL:
                    return False
                status = 'stopped' if current['stop_requested'] else 'failed'
                record = deepcopy(current)
            fields = {'message': 'Rendering stopped by user'} if status == 'stopped' else {
                'stage': 'failed', 'message': message,
            }
            record['job'].update(fields)
            record['job']['status'] = status
            if status == 'failed':
                record['error_detail'] = {'message': message, 'at': utc_now()}
            self._commit_locked(job_id, record, persist=True)
            return True

    def finish_success(self, job_id, publish_output, rollback_output=None):
        """Serialize stop against publication and roll back output if completion cannot persist."""
        lock = self._lock_for(job_id)
        with lock:
            with self._guard:
                current = self.records.get(job_id)
                if current is None or current['job']['status'] in JOB_TERMINAL:
                    return False
                record = deepcopy(current)
            if record['stop_requested']:
                record['job'].update(status='stopped', message='Rendering stopped by user')
                self._commit_locked(job_id, record, persist=True)
                return False
            video = publish_output()
            record['job'].update(
                status='completed', stage='complete',
                completed_frames=record['job']['total_frames'], progress=100,
                message='Video ready', video=video,
            )
            record['output_reference'] = video
            try:
                self._commit_locked(job_id, record, persist=True)
            except Exception:
                if rollback_output is not None:
                    try:
                        rollback_output()
                    except Exception:
                        logging.exception('Could not roll back published output for render job %s', job_id)
                raise
            return True

    def register_process(self, job_id, process):
        lock = self._lock_for(job_id)
        with lock:
            with self._guard:
                record = self.records.get(job_id)
                if record is None or record['job']['status'] in JOB_TERMINAL or record['stop_requested']:
                    return False
                self.processes[job_id] = process
                return True

    def clear_process(self, job_id):
        with self._guard:
            self.processes.pop(job_id, None)

    def stop_requested(self, job_id):
        with self._guard:
            record = self.records.get(job_id)
            return record is None or record['stop_requested'] or record['job']['status'] in JOB_TERMINAL

