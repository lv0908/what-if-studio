from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator, model_validator
from pathlib import Path
from typing import Literal
from threading import Thread, Lock, Event
import shutil, subprocess, uuid, json, re, os, time, signal, math
from scripts.story_scale import scale_timeline
from app.render_progress import apply_render_progress, parse_render_progress

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
    id: str | None = Field(default=None, min_length=1, max_length=64, pattern=r'^[a-zA-Z0-9_-]+$')
    actor_id: str | None = Field(default=None, min_length=1, max_length=64, pattern=r'^[a-zA-Z0-9_-]+$')
    visible: bool = True

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
    actor_ids: list[str] = Field(default_factory=list, max_length=100)
    asset_ids: list[str] = Field(default_factory=list, max_length=100)
    events: list['SceneEvent'] = Field(default_factory=list, max_length=200)

    @field_validator('captions', 'objects_and_characters')
    @classmethod
    def bound_item_text(cls, items):
        if any(len(item) > 500 for item in items):
            raise ValueError('Caption and object text must be 500 characters or fewer.')
        return items


def _valid_contract_id(value: str) -> str:
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', value):
        raise ValueError('IDs must contain 1 to 64 letters, numbers, underscores, or hyphens.')
    return value


class StoryAsset(BaseModel):
    model_config = {'extra': 'forbid', 'strict': True}
    id: str
    type: Literal['image', 'model', 'audio', 'video', 'font', 'other'] = 'other'
    uri: str = Field(min_length=1, max_length=2000)
    metadata: dict[str, str | int | float | bool | None] = Field(default_factory=dict)

    @field_validator('id')
    @classmethod
    def validate_id(cls, value): return _valid_contract_id(value)

    @field_validator('uri')
    @classmethod
    def safe_asset_reference(cls, value):
        if value.startswith(('javascript:', 'data:')):
            raise ValueError('Asset references must be paths or URLs, not executable or embedded data.')
        return value


class StoryActor(BaseModel):
    model_config = {'extra': 'forbid', 'strict': True}
    id: str
    name: str = Field(min_length=1, max_length=160)
    description: str = Field(default='', max_length=2000)
    asset_id: str | None = None
    metadata: dict[str, str | int | float | bool | None] = Field(default_factory=dict)

    @field_validator('id')
    @classmethod
    def validate_id(cls, value): return _valid_contract_id(value)


class SceneEvent(BaseModel):
    model_config = {'extra': 'forbid', 'strict': True}
    id: str
    type: Literal['enter', 'exit', 'move', 'walk', 'run', 'turn', 'wait', 'follow', 'move_toward', 'approach', 'look_at', 'appear', 'disappear']
    start: float = Field(ge=0, allow_inf_nan=False)
    duration: float = Field(default=0, ge=0, allow_inf_nan=False)
    actor_ids: list[str] = Field(default_factory=list, max_length=100)
    asset_ids: list[str] = Field(default_factory=list, max_length=100)
    data: dict[str, str | int | float | bool | None] = Field(default_factory=dict)
    actor_id: str | None = Field(default=None, min_length=1, max_length=64, pattern=r'^[a-zA-Z0-9_-]+$')
    target_id: str | None = Field(default=None, min_length=1, max_length=64, pattern=r'^[a-zA-Z0-9_-]+$')
    from_position: list[float] | None = Field(default=None, min_length=3, max_length=3)
    to_position: list[float] | None = Field(default=None, min_length=3, max_length=3)
    from_rotation: list[float] | None = Field(default=None, min_length=3, max_length=3)
    to_rotation: list[float] | None = Field(default=None, min_length=3, max_length=3)
    parameters: dict[str, str | int | float | bool | list[float] | None] = Field(default_factory=dict)
    easing: Literal['linear', 'ease_in', 'ease_out', 'ease_in_out'] = 'linear'

    @model_validator(mode='before')
    @classmethod
    def normalize_event_fields(cls, value):
        if not isinstance(value, dict): return value
        result = dict(value); data = result.get('data') or {}
        if not isinstance(data, dict): return result
        if result.get('actor_id') is None:
            if data.get('actor_id') is not None: result['actor_id'] = data['actor_id']
            elif len(result.get('actor_ids', [])) == 1: result['actor_id'] = result['actor_ids'][0]
        for key in ('target_id', 'from_position', 'to_position', 'from_rotation', 'to_rotation', 'easing'):
            if result.get(key) is None and key in data: result[key] = data[key]
        if 'parameters' not in result:
            result['parameters'] = data.get('parameters', data.get('params', {}))
        return result

    @field_validator('from_position', 'to_position', 'from_rotation', 'to_rotation')
    @classmethod
    def valid_event_vector(cls, value, info):
        if value is not None and any(not math.isfinite(v) or not (-500 <= v <= 500) for v in value):
            raise ValueError(f'{info.field_name} values must be finite and between -500 and 500.')
        return value

    @model_validator(mode='after')
    def validate_action_fields(self):
        allowed_parameters = {'follow': {'offset'}, 'move_toward': {'distance'}, 'approach': {'distance'}, 'turn': {'rotation'}}.get(self.type, set())
        unsupported = set(self.parameters) - allowed_parameters
        if unsupported:
            raise ValueError(f"Event '{self.id}' has unsupported parameter(s): {', '.join(sorted(unsupported))}.")
        if not self.actor_id:
            raise ValueError(f"Event '{self.id}' requires actor_id (the instance it controls).")
        if self.type in {'follow', 'move_toward', 'approach', 'look_at'} and not self.target_id:
            raise ValueError(f"Event '{self.id}' ({self.type}) requires target_id.")
        if self.type in {'move', 'walk', 'run'} and self.to_position is None:
            raise ValueError(f"Event '{self.id}' ({self.type}) requires to_position.")
        if self.type == 'turn' and self.to_rotation is None and not isinstance(self.parameters.get('rotation'), list):
            raise ValueError(f"Event '{self.id}' (turn) requires to_rotation or parameters.rotation.")
        for key, value in self.parameters.items():
            if isinstance(value, float) and not math.isfinite(value):
                raise ValueError(f"Event '{self.id}' parameter '{key}' must be finite.")
            if isinstance(value, list) and (len(value) != 3 or any(not math.isfinite(v) or not (-500 <= v <= 500) for v in value)):
                raise ValueError(f"Event '{self.id}' parameter '{key}' must be a finite three-number vector.")
        if 'distance' in self.parameters and (not isinstance(self.parameters['distance'], (int, float)) or self.parameters['distance'] < 0):
            raise ValueError(f"Event '{self.id}' parameter 'distance' must be nonnegative.")
        return self

    @field_validator('id')
    @classmethod
    def validate_id(cls, value): return _valid_contract_id(value)


class CameraTrack(BaseModel):
    model_config = {'extra': 'forbid', 'strict': True}
    id: str
    scene_id: str
    keyframes: list[dict[str, float | list[float] | str]] = Field(min_length=1, max_length=500)


class StoryTransition(BaseModel):
    model_config = {'extra': 'forbid', 'strict': True}
    id: str
    from_scene_id: str
    to_scene_id: str
    type: str = Field(default='fade', min_length=1, max_length=80)
    duration: float = Field(default=0, ge=0, le=30, allow_inf_nan=False)


class LightingCue(BaseModel):
    model_config = {'extra': 'forbid', 'strict': True}
    id: str
    scene_id: str
    start: float = Field(ge=0, allow_inf_nan=False)
    duration: float = Field(default=0, ge=0, allow_inf_nan=False)
    settings: dict[str, str | int | float | bool | None]


class AudioCue(BaseModel):
    model_config = {'extra': 'forbid', 'strict': True}
    id: str
    scene_id: str
    start: float = Field(ge=0, allow_inf_nan=False)
    duration: float = Field(default=0, ge=0, allow_inf_nan=False)
    asset_id: str | None = None
    kind: str = Field(default='sound', min_length=1, max_length=80)
    settings: dict[str, str | int | float | bool | None] = Field(default_factory=dict)


class StoryDocument(BaseModel):
    model_config = {'extra': 'forbid', 'strict': True}
    schema_version: Literal[2] = 2
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
    actors: list[StoryActor] = Field(default_factory=list, max_length=500)
    assets: list[StoryAsset] = Field(default_factory=list, max_length=1000)
    camera_tracks: list[CameraTrack] = Field(default_factory=list, max_length=500)
    transitions: list[StoryTransition] = Field(default_factory=list, max_length=500)
    lighting_cues: list[LightingCue] = Field(default_factory=list, max_length=1000)
    audio_cues: list[AudioCue] = Field(default_factory=list, max_length=1000)

    @model_validator(mode='before')
    @classmethod
    def normalize_legacy_contract(cls, value):
        if not isinstance(value, dict):
            return value
        version = value.get('schema_version', 1)
        if version not in (1, 2):
            raise ValueError(f'Unsupported storyboard schema_version {version!r}; supported versions are 1 and 2.')
        normalized = dict(value)
        normalized['schema_version'] = 2
        for key in ('actors', 'assets', 'camera_tracks', 'transitions', 'lighting_cues', 'audio_cues'):
            normalized.setdefault(key, [])
        return normalized

    def check_duration(self):
        total = sum(scene.duration for scene in self.scenes)
        if abs(total - self.duration) > 0.01:
            raise ValueError(f'Scene durations total {total:g}s; expected {self.duration}s.')
        return self

    @model_validator(mode='after')
    def check_references_and_timing(self):
        def unique(items, label):
            ids = [item.id for item in items]
            if len(ids) != len(set(ids)):
                raise ValueError(f'{label} IDs must be unique.')
        unique(self.scenes, 'Scene')
        unique(self.actors, 'Actor')
        unique(self.assets, 'Asset')
        scene_ids = {scene.id for scene in self.scenes}
        actor_ids = {actor.id for actor in self.actors}
        asset_ids = {asset.id for asset in self.assets}
        for actor in self.actors:
            if actor.asset_id and actor.asset_id not in asset_ids:
                raise ValueError(f"Actor '{actor.id}' references unknown asset '{actor.asset_id}'.")
        for scene in self.scenes:
            if len(scene.actor_ids) != len(set(scene.actor_ids)):
                raise ValueError(f"Scene '{scene.id}' contains duplicate actor references.")
            if len(scene.asset_ids) != len(set(scene.asset_ids)):
                raise ValueError(f"Scene '{scene.id}' contains duplicate asset references.")
            for actor_id in scene.actor_ids:
                if actor_id not in actor_ids: raise ValueError(f"Scene '{scene.id}' references unknown actor '{actor_id}'.")
            for asset_id in scene.asset_ids:
                if asset_id not in asset_ids: raise ValueError(f"Scene '{scene.id}' references unknown asset '{asset_id}'.")
            props = scene.visual.props
            prop_ids = [prop.id for prop in props if prop.id]
            actor_aliases = [prop.actor_id for prop in props if prop.actor_id]
            if len(prop_ids) != len(set(prop_ids)):
                raise ValueError(f"Scene '{scene.id}' has duplicate instance IDs.")
            if len(actor_aliases) != len(set(actor_aliases)):
                raise ValueError(f"Scene '{scene.id}' has duplicate actor instance references.")
            reference_owner = {}
            instance_refs = {}
            for index, prop in enumerate(props):
                canonical = prop.id or prop.actor_id or f'{scene.id}-prop-{index + 1}'
                for reference in {prop.id, prop.actor_id} - {None}:
                    if reference in reference_owner and reference_owner[reference] != index:
                        raise ValueError(f"Scene '{scene.id}' has conflicting instance reference '{reference}'.")
                    reference_owner[reference] = index
                    instance_refs[reference] = canonical
            instance_ids = set(instance_refs)
            for prop in props:
                if prop.actor_id and prop.actor_id not in actor_ids:
                    raise ValueError(f"Instance '{prop.id or prop.actor_id}' references unknown actor '{prop.actor_id}'.")
            unique(scene.events, f"Event in scene '{scene.id}'")
            occupied = {}
            for event in scene.events:
                if event.start + event.duration > scene.duration + 0.000001:
                    raise ValueError(f"Event '{event.id}' in scene '{scene.id}' exceeds the scene duration.")
                if event.actor_id not in instance_ids:
                    raise ValueError(f"Event '{event.id}' references unknown scene instance '{event.actor_id}'.")
                if event.target_id and event.target_id not in instance_ids:
                    raise ValueError(f"Event '{event.id}' references unknown target instance '{event.target_id}'.")
                for actor_id in event.actor_ids:
                    if actor_id not in actor_ids: raise ValueError(f"Event '{event.id}' references unknown actor '{actor_id}'.")
                for asset_id in event.asset_ids:
                    if asset_id not in asset_ids: raise ValueError(f"Event '{event.id}' references unknown asset '{asset_id}'.")
                if event.actor_id in event.actor_ids and len(event.actor_ids) > 1:
                    raise ValueError(f"Event '{event.id}' must use actor_id for its subject; actor_ids may list additional participants.")
                canonical_actor = instance_refs[event.actor_id]
                canonical_target = instance_refs.get(event.target_id) if event.target_id else None
                if canonical_actor == canonical_target:
                    raise ValueError(f"Event '{event.id}' cannot target itself.")
                event_properties = []
                if event.type in {'enter', 'exit', 'move', 'walk', 'run', 'follow', 'move_toward', 'approach'}: event_properties.append('position')
                if event.type in {'turn', 'look_at'}: event_properties.append('rotation')
                if event.type in {'enter', 'exit', 'appear', 'disappear'}: event_properties.append('visible')
                if event.type in {'walk', 'run'}: event_properties.append('motion')
                for prop in event_properties:
                    key = (canonical_actor, prop)
                    for prior in occupied.get(key, []):
                        if prior.duration == event.duration == 0: overlaps = prior.start == event.start
                        elif prior.duration == 0: overlaps = prior.start >= event.start and prior.start < event.start + event.duration
                        elif event.duration == 0: overlaps = event.start >= prior.start and event.start < prior.start + prior.duration
                        else: overlaps = max(prior.start, event.start) < min(prior.start + prior.duration, event.start + event.duration)
                        if overlaps:
                            raise ValueError(f"Events '{prior.id}' and '{event.id}' conflict on {prop} for instance '{canonical_actor}'.")
                    occupied.setdefault(key, []).append(event)
            dependencies = {}
            for event in scene.events:
                if event.type in {'follow', 'move_toward', 'approach', 'look_at'}:
                    dependencies.setdefault(instance_refs[event.actor_id], set()).add(instance_refs[event.target_id])
            visiting, visited = set(), set()
            def visit_interaction(instance_id):
                if instance_id in visiting: raise ValueError(f"Interaction cycle detected at scene instance '{instance_id}'.")
                if instance_id in visited: return
                visiting.add(instance_id)
                for dependency in dependencies.get(instance_id, ()): visit_interaction(dependency)
                visiting.remove(instance_id); visited.add(instance_id)
            for instance_id in instance_ids: visit_interaction(instance_id)
        for track in self.camera_tracks:
            if track.scene_id not in scene_ids: raise ValueError(f"Camera track '{track.id}' references unknown scene '{track.scene_id}'.")
        for cue in [*self.lighting_cues, *self.audio_cues]:
            if cue.scene_id not in scene_ids: raise ValueError(f"Cue '{cue.id}' references unknown scene '{cue.scene_id}'.")
            scene = next(scene for scene in self.scenes if scene.id == cue.scene_id)
            if cue.start + cue.duration > scene.duration + 0.000001:
                raise ValueError(f"Cue '{cue.id}' exceeds scene '{cue.scene_id}' duration.")
        for cue in self.audio_cues:
            if cue.asset_id and cue.asset_id not in asset_ids:
                raise ValueError(f"Audio cue '{cue.id}' references unknown asset '{cue.asset_id}'.")
        unique(self.camera_tracks, 'Camera track'); unique(self.transitions, 'Transition')
        unique(self.lighting_cues, 'Lighting cue'); unique(self.audio_cues, 'Audio cue')
        for transition in self.transitions:
            if transition.from_scene_id not in scene_ids or transition.to_scene_id not in scene_ids:
                raise ValueError(f"Transition '{transition.id}' references an unknown scene.")
        return self


StoryScene.model_rebuild()
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
    log_stream = None
    try:
        if STOP_EVENTS[job_id].is_set():
            with LOCK: JOBS[job_id].update(status='stopped', message='Rendering stopped by user')
            return
        with LOCK: JOBS[job_id].update(status='preparing', stage='preparing')
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
            with LOCK: JOBS[job_id].update(topic=req.story.title, duration=req.story.duration, total_frames=round(req.story.duration * 30))
        else:
            scale_timeline(episode / 'src/main.js', req.duration)
        with LOCK: JOBS[job_id].update(status='soundtrack', stage='soundtrack', progress=max(JOBS[job_id]['progress'], 5), message='Generating original soundtrack')
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
        with LOCK: JOBS[job_id].update(status='rendering', stage='rendering', progress=max(JOBS[job_id]['progress'], 10), message='Rendering 3D scenes with Chromium and FFmpeg')
        log_path = project / 'render.log'
        # Portrait export sizes: 480p, 720p (default), and 1080p.
        width = req.resolution
        height = round((width * 16 / 9) / 2) * 2
        log_stream = log_path.open('w', encoding='utf-8')
        proc = subprocess.Popen(['node', str(SCRIPTS/'render_parallel.mjs'), '--project', str(episode), '--chunks', os.getenv('RENDER_CHUNKS','2'),
                                 '--w', str(width), '--h', str(height), '--fps','30','--out','media/final.mp4'],
                                stdout=log_stream, stderr=subprocess.STDOUT)
        with LOCK: PROCESSES[job_id] = proc
        log_offset = 0
        log_buffer = ''

        def consume_render_progress():
            nonlocal log_offset, log_buffer
            try:
                with log_path.open('rb') as log_file:
                    log_file.seek(log_offset)
                    appended = log_file.read()
                    log_offset = log_file.tell()
            except OSError:
                return
            log_buffer += appended.decode('utf-8', errors='replace')
            lines = log_buffer.split('\n')
            log_buffer = lines.pop()
            for line in lines:
                event = parse_render_progress(line.rstrip('\r'), JOBS[job_id]['total_frames'])
                if event is not None:
                    with LOCK:
                        apply_render_progress(JOBS[job_id], event)

        while proc.poll() is None:
            if STOP_EVENTS[job_id].is_set():
                proc.send_signal(signal.SIGINT)
                try: proc.wait(timeout=30)
                except subprocess.TimeoutExpired: proc.kill(); proc.wait()
                with LOCK: JOBS[job_id].update(status='stopped', message='Rendering stopped by user')
                return
            time.sleep(1)
            consume_render_progress()
        if log_stream:
            log_stream.flush()
        consume_render_progress()
        if log_buffer:
            event = parse_render_progress(log_buffer.rstrip('\r'), JOBS[job_id]['total_frames'])
            if event is not None:
                with LOCK:
                    apply_render_progress(JOBS[job_id], event)
        if STOP_EVENTS[job_id].is_set():
            with LOCK: JOBS[job_id].update(status='stopped', message='Rendering stopped by user')
            return
        if proc.returncode != 0: raise RuntimeError('Renderer failed. Inspect render.log in the project folder.')
        final = episode / 'media/final.mp4'
        shutil.copy2(final, EXPORTS / f'{job_id}.mp4')
        with LOCK: JOBS[job_id].update(status='completed', stage='complete', completed_frames=JOBS[job_id]['total_frames'], progress=100, message='Video ready', video=f'/api/episodes/{job_id}/video')
    except Exception as e:
        with LOCK: JOBS[job_id].update(status='failed', stage='failed', progress=min(JOBS[job_id].get('progress', 0), 99), message=str(e))
    finally:
        if log_stream:
            log_stream.close()
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
        story = validate_story(StoryDocument.model_validate(data['story']))
        data['story'] = story.model_dump()
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
    total_frames = round(req.duration * 30)
    with LOCK:
        JOBS[job_id] = {'id':job_id,'topic':req.topic,'duration':req.duration,'status':'queued','progress':0,'message':'Queued',
                        'stage':'queued','completed_frames':0,'total_frames':total_frames,'frame_progress_kind':'captured_and_submitted'}
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
