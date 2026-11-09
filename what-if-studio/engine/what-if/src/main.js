// Timeline, overlay and render loop for "What if no one could die?"
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { plaza, hospital, cemetery, street } from './scenes-a.js';
import { market, park, ocean, launch, earth } from './scenes-b.js';
import { clamp, smooth, lerp } from './lib.js';

/* ---------- the story ---------- */
// pop: world population at the start/end of each shot. Assumes ~134M births a year at first,
// falling as countries restrict births, and zero deaths.
export const TIMELINE = [
  { build: plaza, dur: 8.0, when: 'DAY 0', pop: [8312604118, 8312604152], caps: [[0.3, 3.9, 'What if, at midnight tonight, nobody could die?'], [4.1, 7.8, 'Not from age. Not from illness. Not from anything.']] },
  { build: hospital, dur: 7.0, when: 'DAY 1', pop: [8312975402, 8312975436], caps: [[0.3, 3.4, 'By morning, every hospital is overflowing.'], [3.6, 6.8, 'No one dies. But no one heals any faster.']] },
  { build: cemetery, dur: 6.5, when: 'MONTH 3', pop: [8346118227, 8346121509], caps: [[0.3, 3.1, 'Funeral homes close their doors.'], [3.3, 6.3, 'The cemeteries go silent.']] },
  { build: street, dur: 7.5, when: 'YEAR 2', pop: [8580533871, 8594212650], caps: [[0.3, 3.6, 'Every year, 134 million babies are born.'], [3.8, 7.3, 'And nobody ever leaves.']] },
  { build: market, dur: 7.0, when: 'YEAR 6', pop: [9104822190, 9121530418], caps: [[0.3, 3.3, 'Food prices triple.'], [3.5, 6.8, 'Clean water becomes worth more than gold.']] },
  { build: park, dur: 7.5, when: 'YEAR 45', pop: [13262091377, 13274880512], caps: [[0.3, 3.6, 'Bodies still age. They just never stop.'], [3.8, 7.3, 'One in eight people is now over 100.']] },
  { build: ocean, dur: 7.5, when: 'YEAR 90', pop: [17108440925, 17119072364], caps: [[0.3, 3.6, 'We build cities on the oceans.'], [3.8, 7.3, 'Four in ten people are older than a century.']] },
  { build: launch, dur: 7.5, when: 'YEAR 160', pop: [21306715048, 21311902237], caps: [[0.3, 3.6, 'Everyone alive on Day 0 is now over 160.'], [3.8, 7.3, 'And Earth has run out of room.']] },
  { build: earth, dur: 7.0, when: 'YEAR 161', pop: [21366004129, 21366004390], caps: [[0.4, 2.9, 'So we leave.'], [3.2, 7.0, 'What would you do with forever?', 'final']] },
];
let acc = 0;
for (const s of TIMELINE) { s.start = acc; acc += s.dur; }
export const DURATION = acc;

/* ---------- renderer ---------- */
const canvas = document.getElementById('gl');
const params = new URLSearchParams(location.search);
const RENDER_MODE = params.has('render');
const W = Number(params.get('w') || 1080), H = Number(params.get('h') || 1920);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: RENDER_MODE, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
const renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 1, 0.5, 0.7);
composer.addPass(renderPass); composer.addPass(bloom); composer.addPass(new OutputPass());
composer.setSize(W, H);

/* ---------- overlay ---------- */
const $ = (id) => document.getElementById(id);
const popEl = $('pop'), whenEl = $('when'), capEl = $('cap'), fadeEl = $('fade'), grainEl = $('grain'), hudEl = $('hud');
const fmt = new Intl.NumberFormat('en-US');
let lastCap = null;

function overlay(T, s, local) {
  const u = clamp(local / s.dur);
  const pop = Math.floor(lerp(s.pop[0], s.pop[1], u));
  popEl.textContent = fmt.format(pop);
  whenEl.textContent = s.when;
  hudEl.style.opacity = String(smooth((T - 0.4) / 0.8));

  let text = '', a = 0, final = false;
  for (const [a0, a1, txt, kind] of s.caps) {
    if (local >= a0 - 0.01 && local <= a1 + 0.01) {
      text = txt; final = kind === 'final';
      a = smooth((local - a0) / 0.35) * (final ? 1 : smooth((a1 - local) / 0.3));
    }
  }
  if (text !== lastCap) {
    capEl.innerHTML = text.split(' ').map((w, i) => `<span style="--i:${i}">${w}</span>`).join(' ');
    lastCap = text;
  }
  capEl.classList.toggle('final', final);
  capEl.style.opacity = String(a);
  capEl.style.transform = `translate(-50%, ${(1 - a) * 0.6}vh)`;
  capEl.style.filter = `blur(${(1 - a) * 3}px)`;
  // the closing line reveals word by word
  const finalStart = final ? s.caps.find((c) => c[3] === 'final')[0] : 0;
  [...capEl.children].forEach((sp, i) => { sp.style.opacity = final ? String(smooth((local - finalStart - i * 0.14) / 0.5)) : '1'; });

  // fade through black between shots, longer fade out at the very end
  const isLast = s === TIMELINE[TIMELINE.length - 1];
  const fin = s === TIMELINE[0] ? 0.6 : 0.3, fout = isLast ? 1.2 : 0.3;
  const black = Math.max(1 - smooth(local / fin), 1 - smooth((s.dur - local) / fout));
  fadeEl.style.opacity = String(black);
  grainEl.style.backgroundPosition = `${Math.floor(T * 24 * 37) % 200}px ${Math.floor(T * 24 * 53) % 200}px`;
}

/* ---------- build + render ---------- */
let built = false;
async function init() {
  await Promise.all([
    document.fonts.load('400 40px "Libre Baskerville"'), document.fonts.load('italic 400 40px "Libre Baskerville"'),
    document.fonts.load('700 40px "Space Mono"'), document.fonts.load('800 40px Inter'), document.fonts.load('600 40px Inter'),
  ]);
  for (const s of TIMELINE) s.shot = s.build();
  // warm up: compile every scene once
  for (const s of TIMELINE) { s.shot.update(0.01, s.dur); renderer.compile(s.shot.scene, s.shot.camera); }
  built = true;
}

export function renderAt(T) {
  T = clamp(T, 0, DURATION - 1e-3);
  const s = TIMELINE.find((x) => T >= x.start && T < x.start + x.dur) || TIMELINE[TIMELINE.length - 1];
  const local = T - s.start;
  const shot = s.shot;
  shot.update(local, s.dur);
  renderPass.scene = shot.scene; renderPass.camera = shot.camera;
  [bloom.strength, bloom.radius, bloom.threshold] = shot.bloom;
  renderer.toneMappingExposure = shot.exposure;
  composer.render();
  overlay(T, s, local);
}

/* ---------- sizing ---------- */
function fit() {
  const stage = $('stage');
  const vw = window.innerWidth, vh = window.innerHeight;
  const h = RENDER_MODE ? vh : Math.min(vh, vw * 16 / 9);
  stage.style.height = `${h}px`; stage.style.width = `${h * 9 / 16}px`;
  stage.style.setProperty('--u', `${h / 100}px`);
}
window.addEventListener('resize', fit); fit();

window.__whatif = { renderAt, DURATION, TIMELINE, ready: init() };

/* ---------- interactive player ---------- */
if (!RENDER_MODE) {
  const audio = $('audio'), playBtn = $('play'), bar = $('bar');
  let playing = false, t0 = 0, offset = Number(params.get('t') || 0);
  const now = () => (audio && !audio.error && audio.readyState > 0 && !audio.paused ? audio.currentTime : offset + (playing ? (performance.now() - t0) / 1000 : 0));
  window.__whatif.ready.then(() => { renderAt(offset); playBtn.classList.add('ready'); });
  const start = () => {
    if (!built) return;
    playBtn.classList.add('hidden');
    if (offset >= DURATION - 0.05) offset = 0;
    playing = true; t0 = performance.now();
    if (audio) { audio.currentTime = offset; audio.play().catch(() => {}); }
  };
  const pause = () => { offset = now(); playing = false; audio && audio.pause(); playBtn.classList.remove('hidden'); };
  $('stage').addEventListener('click', () => (playing ? pause() : start()));
  window.addEventListener('keydown', (e) => { if (e.code === 'Space') { e.preventDefault(); playing ? pause() : start(); } });
  const loop = () => {
    if (built && playing) {
      const T = now();
      if (T >= DURATION) { offset = DURATION; pause(); } else renderAt(T);
      bar.style.width = `${(T / DURATION) * 100}%`;
    }
    requestAnimationFrame(loop);
  };
  loop();
}
