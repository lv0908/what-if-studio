# What If Studio — local Docker edition

A browser-based local UI around the original bundled What If 3D Shorts rendering engine.

## Run

1. Install Docker Desktop and ensure its Linux container engine is running.
2. Extract this folder.
3. In a terminal inside this folder run:

   ```bash
   docker compose up --build -d
   ```

4. Open <http://localhost:3000>.
5. Enter a premise, choose 30/45/60/75 seconds and a soundtrack mood, then create an episode.

Stop with `docker compose down`. Projects and exports persist under `./storage`.

## Included

- Original bundled Three.js scenes, fonts, vendored Three.js and branding template.
- Original render scripts, parallel chunk renderer, procedural soundtrack and packaging utility.
- Chromium/Playwright, FFmpeg, Python and NumPy in the Docker image.
- FastAPI job API and a small responsive web interface with progress polling and in-browser MP4 playback.

## Current milestone / limitations

This is the first runnable engine-and-web-shell milestone, not the completed AI story editor. The bundled sample scene sequence is currently used as the visual template for every submitted topic; the requested topic is stored in the project metadata but is not yet rewritten into bespoke scene content. Duration selection proportionally retimes the bundled scene durations and caption timings to 30/45/60/75 seconds. AI story generation, editable per-scene storyboards, authentication, multi-user isolation, and a persistent job database are planned next. No AI API key is required to render the bundled template.

The Docker image is built on the user's machine by `docker compose up --build`; this workspace does not have Docker installed, so the image has not been built or smoke-tested here.

## API

- `GET /api/health`
- `POST /api/episodes` — `{ "topic": "...", "duration": 30, "mood": "dark" }`
- `GET /api/episodes`
- `GET /api/episodes/{id}`
- `GET /api/episodes/{id}/video`

## Source attribution

The `engine/` template and `scripts/` are copied from the user-provided `what-if-3d-shorts.skill` package. Preserve its bundled Three.js license file in `engine/what-if/vendor/three/LICENSE`.
