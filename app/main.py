from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator
from pathlib import Path
from typing import Literal
from threading import Thread, Lock, Event
import shutil, subprocess, uuid, json, re, os, time, signal, math
from scripts.story_scale import scale_timeline

ROOT = Path('/app')
PROJECTS = Path(os.getenv('PROJECTS_DIR', '/data/projects'))
STORY_PROJECTS = Path(os.getenv('STORY_PROJECTS_DIR', str(PROJECTS.parent / 'story-projects')))
EXPORTS = Path(os.getenv('EXPORTS_DIR', '/data/exports'))
TEMPLATE = ROOT / 'engine' / 'what-if'
SCRIPTS = ROOT / 'scripts'
PROJECTS.mkdir(parents=True, exist_ok=True); STORY_PROJECTS.mkdir(parents=True, exist_ok=True); EXPORTS.mkdir(parents=True, exist_ok=True)
app = FastAPI(title='What If Studio API', version='0.1.0')
JOBS = {}; STOP_EVENTS = {}; PROCESSES = {}; LOCK = Lock()

class EpisodeRequest(BaseModel):
    topic: str = Field(min_length=5, max_length=500)
    duration: int = Field(default=30, ge=30, le=75)
    mood: str = Field(default='dark', pattern='^(dark|hopeful|tense)$')
    resolution: Literal[480, 720, 1080] = 720
    story: 'StoryDocument | None' = None


class SceneProp(BaseModel):
    model_config = {'extra': 'forbid', 'strict': True}
    kind: Literal['dinosaur', 'human', 'tree', 'coral', 'rock', 'building', 'submarine', 'fish', 'bubble', 'vehicle', 'crystal']
    name: str = Field(default='', max_length=80)
    color: str = Field(default='#78a85b', pattern=r'^#[0-9a-fA-F]{6}$')
    position: list[float] = Field(default_factory=lambda: [0.0, 0.0, -6.0], min_length=3, max_length=3)
    rotation: list[float] = Field(default_factory=lambda: [0.0, 0.0, 0.0], min_length=3, max_length=3)
    scale: list[float] = Field(default_factory=lambda: [1.0, 1.0, 1.0], min_length=3, max_length=3)
    motion: Literal['still', 'walk', 'swim', 'fly', 'bob', 'spin'] = 'still'

    @field_validator('position', 'rotation', 'scale')
    @classmethod
    def finite_bounded_vector(cls, value, info):
        if any(not math.isfinite(v) or not (-500 <= v <= 500) for v in value):
            raise ValueError(f'{info.field_name} components must be between -500 and 500.')
        if info.field_name == 'scale' and any(v <= 0 or v > 100 for v in value):
            raise ValueError('scale components must be greater than 0 and at most 100.')
        return value


class SceneVisual(BaseModel):
    model_config = {'extra': 'forbid', 'strict': True}
    environment: Literal['plain', 'prehistoric_jungle', 'underwater_city', 'ocean', 'desert', 'forest', 'city', 'space'] = 'plain'
    background: str = Field(default='#101827', pattern=r'^#[0-9a-fA-F]{6}$')
    ground: str = Field(default='#27352d', pattern=r'^#[0-9a-fA-F]{6}$')
    props: list[SceneProp] = Field(default_factory=list, max_length=30)
    camera_position: list[float] = Field(default_factory=lambda: [0.0, 2.2, 12.0], min_length=3, max_length=3)
    camera_look_at: list[float] = Field(default_factory=lambda: [0.0, 1.4, 0.0], min_length=3, max_length=3)
    camera_movement: Literal['static', 'push', 'pan', 'orbit'] = 'static'
    light_color: str = Field(default='#ffffff', pattern=r'^#[0-9a-fA-F]{6}$')
    light_intensity: float = Field(default=1.5, ge=0, le=10, allow_inf_nan=False)
    fog_color: str = Field(default='#101827', pattern=r'^#[0-9a-fA-F]{6}$')
    fog_density: float = Field(default=0.012, ge=0, le=0.2, allow_inf_nan=False)
    transition: Literal['fade', 'cut'] = 'fade'

    @field_validator('camera_position', 'camera_look_at')
    @classmethod
    def bounded_camera_vector(cls, value, info):
        if any(not math.isfinite(v) or not (-500 <= v <= 500) for v in value):
            raise ValueError(f'{info.field_name} components must be finite and between -500 and 500.')
        return value


class StoryScene(BaseModel):
    model_config = {'extra': 'forbid', 'strict': True}
    id: str = Field(min_length=1, max_length=64, pattern=r'^[a-zA-Z0-9_-]+$')
    title: str = Field(min_length=1, max_length=160)
    duration: float = Field(gt=0, le=300, allow_inf_nan=False)
    narration: str = Field(max_length=5000)
    captions: list[str] = Field(max_length=12)
    environment: str = Field(max_length=2000)
    objects_and_characters: list[str] = Field(max_length=30)
    camera_position: str = Field(max_length=1000)
    camera_movement: str = Field(max_length=1000)
    lighting_atmosphere: str = Field(max_length=1500)
    animation_instructions: str = Field(max_length=2000)
    transition: str = Field(max_length=500)
    sound_design: str = Field(max_length=1000)
    visual: SceneVisual = Field(default_factory=SceneVisual)

    @field_validator('captions', 'objects_and_characters')
    @classmethod
    def bound_item_text(cls, items):
        if any(len(item) > 500 for item in items):
            raise ValueError('Caption and object text must be 500 characters or fewer.')
        return items


class StoryDocument(BaseModel):
    model_config = {'extra': 'forbid', 'strict': True}
    schema_version: Literal[1] = 1
    topic: str = Field(min_length=5, max_length=500)
    duration: Literal[30, 45, 60, 75]
    tone: str = Field(min_length=1, max_length=80)
    audience: str = Field(min_length=1, max_length=80)
    narrative_style: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=1, max_length=200)
    logline: str = Field(max_length=1000)
    opening_hook: str = Field(max_length=2000)
    narration: str = Field(max_length=20000)
    scenes: list[StoryScene] = Field(min_length=1, max_length=30)
    ending: str = Field(max_length=2000)

    def check_duration(self):
        total = sum(scene.duration for scene in self.scenes)
        if abs(total - self.duration) > 0.01:
            raise ValueError(f'Scene durations total {total:g}s; expected {self.duration}s.')
        return self


EpisodeRequest.model_rebuild()


class StoryProjectRequest(BaseModel):
    model_config = {'extra': 'forbid'}
    story: StoryDocument


def project_path(project_id: str) -> Path:
    if not re.fullmatch(r'[a-f0-9]{12}', project_id):
        raise HTTPException(404, 'Story project not found')
    return STORY_PROJECTS / project_id / 'story.json'


def validate_story(story: StoryDocument):
    try:
        story.check_duration()
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    ids = [scene.id for scene in story.scenes]
    if len(ids) != len(set(ids)):
        raise HTTPException(422, 'Scene IDs must be unique.')
    return story


def run_job(job_id: str, req: EpisodeRequest):
    project = PROJECTS / job_id
    try:
        if STOP_EVENTS[job_id].is_set():
            with LOCK: JOBS[job_id].update(status='stopped', message='Rendering stopped by user')
            return
        with LOCK: JOBS[job_id]['status'] = 'preparing'
        shutil.copytree(TEMPLATE, project / 'what-if')
        if STOP_EVENTS[job_id].is_set():
            with LOCK: JOBS[job_id].update(status='stopped', message='Rendering stopped by user')
            return
        episode = project / 'what-if'
        # Keep the approved storyboard with this render, independent of later project edits.
        (project / 'episode.json').write_text(json.dumps({**req.model_dump(), 'id': job_id, 'created_at': time.time()}, indent=2))
        if req.story:
            validate_story(req.story)
            (episode / 'story.json').write_text(req.story.model_dump_json(), encoding='utf-8')
            with LOCK: JOBS[job_id].update(topic=req.story.title, duration=req.story.duration)
        else:
            scale_timeline(episode / 'src/main.js', req.duration)
        with LOCK: JOBS[job_id].update(status='soundtrack', progress=5, message='Generating original soundtrack')
        soundtrack = subprocess.Popen(['python3', str(SCRIPTS/'soundtrack.py'), '--project', str(episode), '--mood', req.mood,
                        '--sfx', 'countdown+fireworks+crowd, monitor, wind, murmur, ticks, wind, ocean, rocket, shimmer'], stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
        with LOCK: PROCESSES[job_id] = soundtrack
        while soundtrack.poll() is None:
            if STOP_EVENTS[job_id].is_set():
                soundtrack.terminate(); soundtrack.wait(timeout=10)
                with LOCK: JOBS[job_id].update(status='stopped', message='Rendering stopped by user')
                return
            time.sleep(0.25)
        if STOP_EVENTS[job_id].is_set():
            with LOCK: JOBS[job_id].update(status='stopped', message='Rendering stopped by user')
            return
        if soundtrack.returncode: raise RuntimeError('Soundtrack generation failed.')
        with LOCK: JOBS[job_id].update(status='rendering', progress=10, message='Rendering 3D scenes with Chromium and FFmpeg')
        log_path = project / 'render.log'
        # Portrait export sizes: 480p, 720p (default), and 1080p.
        width = req.resolution
        height = round((width * 16 / 9) / 2) * 2
        proc = subprocess.Popen(['node', str(SCRIPTS/'render_parallel.mjs'), '--project', str(episode), '--chunks', os.getenv('RENDER_CHUNKS','2'),
                                 '--w', str(width), '--h', str(height), '--fps','30','--out','media/final.mp4'],
                                stdout=open(log_path,'w'), stderr=subprocess.STDOUT)
        with LOCK: PROCESSES[job_id] = proc
        while proc.poll() is None:
            if STOP_EVENTS[job_id].is_set():
                proc.send_signal(signal.SIGINT)
                try: proc.wait(timeout=30)
                except subprocess.TimeoutExpired: proc.kill(); proc.wait()
                with LOCK: JOBS[job_id].update(status='stopped', message='Rendering stopped by user')
                return
            time.sleep(5)
            try:
                log = log_path.read_text(errors='ignore')[-5000:]
                # Progress is approximate: chunk logs are emitted periodically by the renderer.
                frames = [int(x) for x in re.findall(r'frame (\d+)/(\d+)', log)]
                if frames:
                    pct = min(95, 10 + int(85 * max(frames) / max(int(re.findall(r'frame \d+/(\d+)', log)[-1]),1)))
                    with LOCK: JOBS[job_id].update(progress=pct, message='Rendering frames')
            except Exception: pass
        if STOP_EVENTS[job_id].is_set():
            with LOCK: JOBS[job_id].update(status='stopped', message='Rendering stopped by user')
            return
        if proc.returncode != 0: raise RuntimeError('Renderer failed. Inspect render.log in the project folder.')
        final = episode / 'media/final.mp4'
        shutil.copy2(final, EXPORTS / f'{job_id}.mp4')
        with LOCK: JOBS[job_id].update(status='completed', progress=100, message='Video ready', video=f'/api/episodes/{job_id}/video')
    except Exception as e:
        with LOCK: JOBS[job_id].update(status='failed', message=str(e))
    finally:
        with LOCK: PROCESSES.pop(job_id, None)

@app.get('/', response_class=HTMLResponse)
def home():
    return (ROOT/'app/index.html').read_text(encoding='utf-8')

@app.get('/api/health')
def health(): return {'status':'ok','engine':'bundled-threejs','version':'0.1.0'}


@app.post('/api/story-projects/validate')
def validate_story_project(req: StoryProjectRequest):
    story = validate_story(req.story)
    return {'valid': True, 'duration_total': sum(scene.duration for scene in story.scenes), 'scene_count': len(story.scenes)}


@app.post('/api/story-projects', status_code=201)
def save_story_project(req: StoryProjectRequest):
    story = validate_story(req.story)
    project_id = uuid.uuid4().hex[:12]
    folder = STORY_PROJECTS / project_id
    folder.mkdir(parents=True, exist_ok=False)
    data = {'id': project_id, 'created_at': time.time(), 'updated_at': time.time(), 'story': story.model_dump()}
    target = folder / 'story.json'
    temp = folder / 'story.json.tmp'
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    temp.replace(target)
    return data


@app.get('/api/story-projects')
def list_story_projects():
    results = []
    for file in STORY_PROJECTS.glob('*/story.json'):
        try:
            data = json.loads(file.read_text(encoding='utf-8'))
            results.append({'id': data['id'], 'updated_at': data.get('updated_at'),
                            'title': data['story']['title'], 'topic': data['story']['topic'],
                            'duration': data['story']['duration']})
        except (OSError, ValueError, KeyError, TypeError):
            continue
    return sorted(results, key=lambda x: x.get('updated_at') or 0, reverse=True)


@app.get('/api/story-projects/{project_id}')
def get_story_project(project_id: str):
    target = project_path(project_id)
    if not target.is_file(): raise HTTPException(404, 'Story project not found')
    try:
        data = json.loads(target.read_text(encoding='utf-8'))
        validate_story(StoryDocument.model_validate(data['story']))
        return data
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise HTTPException(500, 'Saved story project is invalid') from exc


@app.put('/api/story-projects/{project_id}')
def update_story_project(project_id: str, req: StoryProjectRequest):
    target = project_path(project_id)
    if not target.is_file(): raise HTTPException(404, 'Story project not found')
    story = validate_story(req.story)
    try:
        old = json.loads(target.read_text(encoding='utf-8'))
    except (OSError, ValueError) as exc:
        raise HTTPException(500, 'Saved story project is invalid') from exc
    data = {'id': project_id, 'created_at': old.get('created_at'), 'updated_at': time.time(), 'story': story.model_dump()}
    temp = target.with_suffix('.json.tmp')
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    temp.replace(target)
    return data

@app.post('/api/episodes', status_code=202)
def create_episode(req: EpisodeRequest):
    if req.story:
        validate_story(req.story)
        if req.story.duration != req.duration or req.story.topic != req.topic:
            raise HTTPException(422, 'Render topic and duration must match the approved storyboard.')
    job_id = uuid.uuid4().hex[:12]
    with LOCK:
        JOBS[job_id] = {'id':job_id,'topic':req.topic,'duration':req.duration,'status':'queued','progress':0,'message':'Queued'}
        STOP_EVENTS[job_id] = Event()
    Thread(target=run_job, args=(job_id, req), daemon=True).start()
    return JOBS[job_id]


@app.post('/api/episodes/{job_id}/stop')
def stop_episode(job_id: str):
    with LOCK:
        if job_id not in JOBS: raise HTTPException(404, 'Episode not found')
        if JOBS[job_id]['status'] in ('completed', 'failed', 'stopped'):
            return JOBS[job_id]
        STOP_EVENTS[job_id].set()
        proc = PROCESSES.get(job_id)
        if proc is None: JOBS[job_id].update(status='stopped', message='Rendering stopped by user')
        result = JOBS[job_id].copy()
    return result

@app.get('/api/episodes')
def list_episodes():
    with LOCK: return list(JOBS.values())

@app.get('/api/episodes/{job_id}')
def get_episode(job_id: str):
    with LOCK:
        if job_id not in JOBS: raise HTTPException(404, 'Episode not found')
        return JOBS[job_id]

@app.get('/api/episodes/{job_id}/video')
def get_video(job_id: str):
    p = EXPORTS / f'{job_id}.mp4'
    if not p.exists(): raise HTTPException(404, 'Video is not ready')
    return FileResponse(p, media_type='video/mp4', filename=f'what-if-{job_id}.mp4')
