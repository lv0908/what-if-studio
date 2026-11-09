from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from pathlib import Path
from threading import Thread, Lock
import shutil, subprocess, uuid, json, re, os, time

ROOT = Path('/app')
PROJECTS = Path(os.getenv('PROJECTS_DIR', '/data/projects'))
EXPORTS = Path(os.getenv('EXPORTS_DIR', '/data/exports'))
TEMPLATE = ROOT / 'engine'
SCRIPTS = ROOT / 'scripts'
PROJECTS.mkdir(parents=True, exist_ok=True); EXPORTS.mkdir(parents=True, exist_ok=True)
app = FastAPI(title='What If Studio API', version='0.1.0')
JOBS = {}; LOCK = Lock()

class EpisodeRequest(BaseModel):
    topic: str = Field(min_length=5, max_length=180)
    duration: int = Field(default=30, ge=30, le=75)
    mood: str = Field(default='dark', pattern='^(dark|hopeful|tense)$')


def scale_timeline(main_file: Path, target: int):
    src = main_file.read_text(encoding='utf-8')
    start = src.index('export const TIMELINE = [')
    end = src.index('\n];', start) + 3
    block = src[start:end]
    durs = [float(x) for x in re.findall(r'\bdur:\s*([\d.]+)', block)]
    if not durs: raise RuntimeError('Could not parse the original scene timeline')
    factor = target / sum(durs)
    block = re.sub(r'(\bdur:\s*)([\d.]+)', lambda m: m.group(1) + f'{float(m.group(2))*factor:.4f}', block)
    # Scale caption start/end values within each scene; population ranges remain unchanged.
    block = re.sub(r"\[(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?),\s*(['\"])",
                   lambda m: f'[{float(m.group(1))*factor:.4f}, {float(m.group(2))*factor:.4f}, {m.group(3)}', block)
    main_file.write_text(src[:start] + block + src[end:], encoding='utf-8')


def run_job(job_id: str, req: EpisodeRequest):
    project = PROJECTS / job_id
    try:
        with LOCK: JOBS[job_id]['status'] = 'preparing'
        shutil.copytree(TEMPLATE, project / 'what-if')
        episode = project / 'what-if'
        # Record the requested premise for the project. The bundled sample scenes remain the
        # visual template until the story-generation adapter is configured in a later milestone.
        (project / 'episode.json').write_text(json.dumps({**req.model_dump(), 'id': job_id, 'created_at': time.time()}, indent=2))
        scale_timeline(episode / 'src/main.js', req.duration)
        with LOCK: JOBS[job_id].update(status='soundtrack', progress=5, message='Generating original soundtrack')
        subprocess.run(['python3', str(SCRIPTS/'soundtrack.py'), '--project', str(episode), '--mood', req.mood,
                        '--sfx', 'countdown+fireworks+crowd, monitor, wind, murmur, ticks, wind, ocean, rocket, shimmer'], check=True)
        with LOCK: JOBS[job_id].update(status='rendering', progress=10, message='Rendering 3D scenes with Chromium and FFmpeg')
        log_path = project / 'render.log'
        proc = subprocess.Popen(['node', str(SCRIPTS/'render_parallel.mjs'), '--project', str(episode), '--chunks', os.getenv('RENDER_CHUNKS','2'),
                                 '--w','1080','--h','1920','--fps','30','--out','media/final.mp4'],
                                stdout=open(log_path,'w'), stderr=subprocess.STDOUT)
        while proc.poll() is None:
            time.sleep(5)
            try:
                log = log_path.read_text(errors='ignore')[-5000:]
                # Progress is approximate: chunk logs are emitted periodically by the renderer.
                frames = [int(x) for x in re.findall(r'frame (\d+)/(\d+)', log)]
                if frames:
                    pct = min(95, 10 + int(85 * max(frames) / max(int(re.findall(r'frame \d+/(\d+)', log)[-1]),1)))
                    with LOCK: JOBS[job_id].update(progress=pct, message='Rendering frames')
            except Exception: pass
        if proc.returncode != 0: raise RuntimeError('Renderer failed. Inspect render.log in the project folder.')
        final = episode / 'media/final.mp4'
        shutil.copy2(final, EXPORTS / f'{job_id}.mp4')
        with LOCK: JOBS[job_id].update(status='completed', progress=100, message='Video ready', video=f'/api/episodes/{job_id}/video')
    except Exception as e:
        with LOCK: JOBS[job_id].update(status='failed', message=str(e))

@app.get('/', response_class=HTMLResponse)
def home():
    return (ROOT/'app/index.html').read_text(encoding='utf-8')

@app.get('/api/health')
def health(): return {'status':'ok','engine':'bundled-threejs','version':'0.1.0'}

@app.post('/api/episodes', status_code=202)
def create_episode(req: EpisodeRequest):
    job_id = uuid.uuid4().hex[:12]
    with LOCK: JOBS[job_id] = {'id':job_id,'topic':req.topic,'duration':req.duration,'status':'queued','progress':0,'message':'Queued'}
    Thread(target=run_job, args=(job_id, req), daemon=True).start()
    return JOBS[job_id]

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
