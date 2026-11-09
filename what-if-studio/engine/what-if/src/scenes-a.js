// Scenes 1-4: midnight plaza, hospital ward, closed cemetery, crowded street.
import * as THREE from 'three';
import {
  rngFrom, clamp, lerp, smooth, easeOut, pick, range, cameraRig, mat, glow, canvasTexture,
  gradientTexture, spriteTexture, windowTexture, building, neonSign, bareTree, drift, Crowd, crowdGrid, SKIN, COATS,
} from './lib.js';

export function shell(bg, fog, density, fov = 45) {
  const scene = new THREE.Scene();
  scene.background = bg instanceof THREE.Texture ? bg : new THREE.Color(bg);
  if (fog) scene.fog = new THREE.FogExp2(fog, density);
  const camera = new THREE.PerspectiveCamera(fov, 9 / 16, 0.1, 1500);
  return { scene, camera };
}

/* ============ 1. Midnight plaza: the moment death stops ============ */
export function plaza() {
  const rng = rngFrom(11);
  const { scene, camera } = shell(gradientTexture([[0, '#04050d'], [0.55, '#111833'], [1, '#2b2543']]), '#161a2e', 0.014);
  scene.add(new THREE.HemisphereLight('#5566a8', '#1a0f0a', 1.1));

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 260), mat('#24242c', { roughness: 0.45, metalness: 0.25 }));
  ground.rotation.x = -Math.PI / 2; ground.position.z = -80; scene.add(ground);

  // Screens on the facades
  const screenDesigns = [
    (g, w, h) => { const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#ff2f7a'); gr.addColorStop(1, '#4b1bbf'); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.font = '800 92px Inter'; g.textAlign = 'center'; g.fillText('HAPPY', w / 2, h / 2 - 20); g.fillText('NEW YEAR', w / 2, h / 2 + 80); },
    (g, w, h) => { g.fillStyle = '#071a3a'; g.fillRect(0, 0, w, h); g.strokeStyle = '#7fd4ff'; g.lineWidth = 16; g.beginPath(); g.arc(w / 2, h / 2, h * 0.36, 0, Math.PI * 2); g.stroke(); g.fillStyle = '#e8f6ff'; g.font = '800 130px Inter'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('00:00', w / 2, h / 2); },
    (g, w, h) => { const gr = g.createRadialGradient(w * 0.3, h * 0.4, 10, w * 0.5, h * 0.5, w * 0.7); gr.addColorStop(0, '#ffe39a'); gr.addColorStop(0.5, '#ff7a2f'); gr.addColorStop(1, '#3a0d12'); g.fillStyle = gr; g.fillRect(0, 0, w, h); },
    (g, w, h) => { const gr = g.createLinearGradient(0, h, w, 0); gr.addColorStop(0, '#0bd1a5'); gr.addColorStop(1, '#0b3d91'); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(255,255,255,.9)'; g.font = '800 70px Inter'; g.textAlign = 'center'; g.fillText('LIVE · CITY SQUARE', w / 2, h * 0.86); },
  ].map((d) => canvasTexture(512, 512, d).tex);

  const facades = [0, 1, 2].map(() => windowTexture(rng, { lit: 0.5 }));
  for (const side of [-1, 1]) {
    let z = 14;
    while (z > -150) {
      const w = range(rng, 8, 14), d = range(rng, 10, 18), h = range(rng, 30, 80);
      const b = building(w, h, d, pick(rng, facades), 1.3);
      b.position.set(side * (13 + w / 2), h / 2, z - d / 2);
      scene.add(b);
      if (rng() < 0.65) {
        const sw = d * 0.75, sh = d * range(rng, 0.55, 0.9);
        const scr = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), new THREE.MeshBasicMaterial({ map: pick(rng, screenDesigns), color: new THREE.Color(1.6, 1.6, 1.6) }));
        scr.position.set(side * 12.9, range(rng, 9, 22), z - d / 2);
        scr.rotation.y = -side * Math.PI / 2;
        scene.add(scr);
      }
      z -= d + range(rng, 0, 1.5);
    }
  }

  // Clock tower + countdown screen at the end of the square
  const tower = building(22, 95, 12, facades[0], 0.8);
  tower.position.set(0, 47.5, -150); scene.add(tower);
  const clock = canvasTexture(512, 512, (g, w) => {
    g.fillStyle = '#f7ecd2'; g.beginPath(); g.arc(w / 2, w / 2, 240, 0, 7); g.fill();
    g.strokeStyle = '#2a1d10'; g.lineWidth = 14; g.stroke();
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; g.lineWidth = 10; g.beginPath(); g.moveTo(256 + Math.sin(a) * 200, 256 - Math.cos(a) * 200); g.lineTo(256 + Math.sin(a) * 228, 256 - Math.cos(a) * 228); g.stroke(); }
    g.lineCap = 'round'; g.lineWidth = 18; g.beginPath(); g.moveTo(256, 256); g.lineTo(256, 110); g.stroke();
    g.lineWidth = 12; g.beginPath(); g.moveTo(256, 256); g.lineTo(256, 70); g.stroke();
  });
  const clockFace = new THREE.Mesh(new THREE.CircleGeometry(6, 32), new THREE.MeshBasicMaterial({ map: clock.tex, color: new THREE.Color(1.4, 1.3, 1.1) }));
  clockFace.position.set(0, 78, -143.9); scene.add(clockFace);
  const count = canvasTexture(1024, 576);
  const countScreen = new THREE.Mesh(new THREE.PlaneGeometry(26, 14.6), new THREE.MeshBasicMaterial({ map: count.tex, color: new THREE.Color(1.8, 1.8, 1.8) }));
  countScreen.position.set(0, 36, -143.8); scene.add(countScreen);
  let lastCount = '';
  const drawCount = (t) => {
    const key = t < 3 ? String(3 - Math.floor(t)) : 'NY';
    if (key === lastCount) return; lastCount = key;
    count.redraw((g, w, h) => {
      g.fillStyle = '#05060c'; g.fillRect(0, 0, w, h);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      if (key !== 'NY') {
        g.strokeStyle = '#ff3d7f'; g.lineWidth = 18; g.beginPath(); g.arc(w / 2, h / 2, 220, 0, Math.PI * 2); g.stroke();
        g.fillStyle = '#ffffff'; g.font = '800 330px Inter'; g.fillText(key, w / 2, h / 2 + 16);
      } else {
        const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#ffcf5a'); gr.addColorStop(1, '#ff3d7f');
        g.fillStyle = gr; g.fillRect(0, 0, w, h);
        g.fillStyle = '#fff'; g.font = '800 120px Inter'; g.fillText('MIDNIGHT', w / 2, h / 2 - 50);
        g.font = '600 70px Inter'; g.fillText('00:00:00', w / 2, h / 2 + 80);
      }
    });
  };

  // Crowd facing the tower
  const people = crowdGrid(rng, {
    x0: -11.5, x1: 11.5, z0: -100, z1: 3, gap: 0.92,
    make: (x, z) => {
      const r = rng();
      return {
        x, z, ry: Math.PI + range(rng, -0.35, 0.35), s: range(rng, 0.9, 1.08),
        body: pick(rng, COATS), legs: pick(rng, ['#1b1c22', '#2a2d3a', '#3a2c22', '#111']), skin: pick(rng, SKIN),
        hat: r < 0.22 ? 'cone' : r < 0.36 ? 'beanie' : r < 0.42 ? 'brim' : null,
        hatColor: pick(rng, ['#ffd23f', '#ff4f8b', '#3ec1ff', '#8affc1', '#ffffff', '#c03a2b']),
        phone: rng() < 0.32, cheer: rng() < 0.45, jumper: rng(), phase: rng() * 10,
        pose: (p, t) => {
          const go = smooth((t - 3.05) / 0.5);
          const jump = go * Math.max(0, Math.sin(t * 7 + p.phase)) * 0.14 * p.jumper;
          const sway = Math.sin(t * 1.4 + p.phase) * 0.05;
          if (p.phone) return { bob: jump, aR: 0.12, fR: 2.2 + Math.sin(t * 2 + p.phase) * 0.12, aL: 0.12 + go * 0.4, tilt: sway, head: -0.2 };
          if (p.cheer) return { bob: jump, aL: lerp(0.1, 2.6, go) + Math.sin(t * 5 + p.phase) * 0.18 * go, aR: lerp(0.1, 2.6, go) + Math.sin(t * 5 + p.phase + 1) * 0.18 * go, tilt: sway, head: -0.15 * go };
          return { bob: jump, tilt: sway, aL: 0.1 + go * 0.25, aR: 0.1 + go * 0.25, head: -0.1 };
        },
      };
    },
  });
  const crowd = new Crowd(people, { phoneGlow: 3.5 });
  scene.add(crowd.group);

  // Fireworks
  const bursts = [];
  for (let i = 0; i < 16; i++) bursts.push({ t0: 3.0 + i * 0.32 + rng() * 0.25, c: new THREE.Vector3(range(rng, -28, 28), range(rng, 38, 62), range(rng, -60, -125)), col: new THREE.Color(pick(rng, ['#ff5a7a', '#ffd36b', '#7fd4ff', '#b58cff', '#7dff9e', '#ffffff', '#ff9a3c'])), n: 150 });
  const NP = bursts.reduce((a, b) => a + b.n, 0);
  const fpos = new Float32Array(NP * 3), fcol = new Float32Array(NP * 3), dirs = [];
  bursts.forEach((b) => { for (let k = 0; k < b.n; k++) { const u = rng() * 2 - 1, th = rng() * Math.PI * 2, s = Math.sqrt(1 - u * u); dirs.push(new THREE.Vector3(Math.cos(th) * s, u, Math.sin(th) * s).multiplyScalar(range(rng, 0.75, 1))); } });
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.BufferAttribute(fpos, 3));
  fg.setAttribute('color', new THREE.BufferAttribute(fcol, 3));
  const fireworks = new THREE.Points(fg, new THREE.PointsMaterial({ size: 0.9, vertexColors: true, map: spriteTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  fireworks.frustumCulled = false; scene.add(fireworks);
  const flash = new THREE.PointLight('#ffd9b0', 0, 0, 0); flash.position.set(0, 50, -70); scene.add(flash);

  const updateFireworks = (t) => {
    let i = 0, fl = 0;
    for (const b of bursts) {
      const age = t - b.t0;
      fl += age > 0 ? Math.exp(-age * 5) : 0;
      for (let k = 0; k < b.n; k++, i++) {
        const d = dirs[i];
        if (age < -0.9 || (age < 0 && k > 0)) { fpos.set([0, -999, 0], i * 3); continue; }
        if (age < 0) { // rising spark
          const u = (age + 0.9) / 0.9;
          fpos.set([b.c.x, lerp(4, b.c.y, easeOut(u)), b.c.z], i * 3); fcol.set([1.2, 1.0, 0.7], i * 3); continue;
        }
        const r = 14 * (1 - Math.exp(-age * 2.4));
        fpos.set([b.c.x + d.x * r, b.c.y + d.y * r - 2.2 * age * age, b.c.z + d.z * r], i * 3);
        const f = Math.exp(-age * 1.15) * (0.75 + 0.25 * Math.sin(age * 40 + k)) * 2.2;
        fcol.set([b.col.r * f, b.col.g * f, b.col.b * f], i * 3);
      }
    }
    flash.intensity = fl * 2.2;
    fg.attributes.position.needsUpdate = true; fg.attributes.color.needsUpdate = true;
  };

  // Confetti
  const NC = 1400;
  const conf = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.09, 0.14), mat('#ffffff', { side: THREE.DoubleSide, roughness: 0.5 }), NC);
  conf.frustumCulled = false; scene.add(conf);
  const cdat = [];
  const cc = new THREE.Color();
  for (let i = 0; i < NC; i++) { cdat.push([range(rng, -12, 12), range(rng, 10, 24), range(rng, -45, 6), 3.1 + rng() * 1.6, rng() * 10, range(rng, 1.2, 2.2)]); conf.setColorAt(i, cc.set(pick(rng, ['#ffd23f', '#ff4f8b', '#3ec1ff', '#8affc1', '#ffffff', '#ff9a3c']))); }
  const cm = new THREE.Matrix4(), cq = new THREE.Quaternion(), ce = new THREE.Euler(), cpv = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), zero = new THREE.Vector3(0, 0, 0);
  const updateConfetti = (t) => {
    cdat.forEach(([x, y, z, t0, ph, sp], i) => {
      const a = t - t0;
      if (a < 0) { cm.compose(cpv.set(0, -99, 0), cq, zero); conf.setMatrixAt(i, cm); return; }
      cq.setFromEuler(ce.set(a * 3 + ph, a * 4 + ph, a * 2));
      cm.compose(cpv.set(x + Math.sin(a * 1.3 + ph) * 0.6, y - a * sp, z + Math.cos(a + ph) * 0.4), cq, one);
      conf.setMatrixAt(i, cm);
    });
    conf.instanceMatrix.needsUpdate = true;
  };

  const lights = [['#ff4f8b', -9, 14, -20], ['#3ec1ff', 9, 14, -35], ['#ffb347', 0, 20, -120]];
  for (const [c, x, y, z] of lights) { const l = new THREE.PointLight(c, 1.4, 60, 1); l.position.set(x, y, z); scene.add(l); }

  const rig = cameraRig(camera, [
    { p: [0, 17, 16], l: [0, 6, -80] },
    { p: [1.2, 10, 5], l: [0, 10, -90] },
    { p: [0, 6.2, -2], l: [0, 14, -100] },
  ]);
  return {
    scene, camera, bloom: [0.95, 0.55, 0.62], exposure: 1.05,
    update(t, dur) {
      drawCount(t);
      crowd.update(t);
      updateFireworks(t);
      updateConfetti(t);
      rig(t / dur, 0.08, t);
    },
  };
}

/* ============ 2. Hospital ward: everyone survives the night ============ */
export function hospital() {
  const rng = rngFrom(22);
  const { scene, camera } = shell('#9fb4b2', '#9fb4b2', 0.016, 50);
  scene.add(new THREE.HemisphereLight('#eaf6ff', '#5f6e6a', 1.25));
  const sun = new THREE.DirectionalLight('#ffffff', 0.7); sun.position.set(3, 10, 4); scene.add(sun);

  const L = 70, W = 14, H = 4.4;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, L), mat('#8ea29c', { roughness: 0.32, metalness: 0.08, flatShading: false }));
  floor.rotation.x = -Math.PI / 2; floor.position.z = -L / 2 + 8; scene.add(floor);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, L), mat('#dfe7e4'));
  ceil.rotation.x = Math.PI / 2; ceil.position.set(0, H, -L / 2 + 8); scene.add(ceil);
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(L, H), mat('#c9d6d2'));
    wall.position.set(side * W / 2, H / 2, -L / 2 + 8); wall.rotation.y = -side * Math.PI / 2; scene.add(wall);
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(L, 0.18), mat('#5f8f8a'));
    stripe.position.set(side * (W / 2 - 0.01), 1.05, -L / 2 + 8); stripe.rotation.y = -side * Math.PI / 2; scene.add(stripe);
  }
  // ceiling light panels
  const panel = new THREE.BoxGeometry(1.1, 0.05, 2.6);
  const panelMat = glow('#effffb', 2.4);
  for (let z = 4; z > -60; z -= 5) for (const x of [-3, 3]) { const m = new THREE.Mesh(panel, panelMat); m.position.set(x, H - 0.03, z); scene.add(m); }

  // ECG strip texture (scrolled per monitor)
  const ecg = canvasTexture(1024, 256, (g, w, h) => {
    g.fillStyle = '#021208'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(60,255,140,.12)'; g.lineWidth = 2;
    for (let x = 0; x < w; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    g.strokeStyle = '#4dff9a'; g.lineWidth = 7; g.shadowColor = '#4dff9a'; g.shadowBlur = 14; g.beginPath();
    const base = h * 0.58;
    for (let x = 0; x <= w; x += 2) {
      const ph = (x % 256) / 256; let y = base;
      if (ph > 0.3 && ph < 0.34) y = base - 18 * Math.sin((ph - 0.3) / 0.04 * Math.PI);
      else if (ph > 0.4 && ph < 0.42) y = base + (ph - 0.4) / 0.02 * 22;
      else if (ph > 0.42 && ph < 0.45) y = base + 22 - (ph - 0.42) / 0.03 * 150;
      else if (ph > 0.45 && ph < 0.48) y = base - 128 + (ph - 0.45) / 0.03 * 150;
      else if (ph > 0.6 && ph < 0.7) y = base - 26 * Math.sin((ph - 0.6) / 0.1 * Math.PI);
      x === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.stroke();
  }).tex;
  ecg.wrapS = THREE.RepeatWrapping;
  const monitors = [];

  const frameMat = mat('#b9c3c7', { metalness: 0.4, roughness: 0.4 }), sheetMat = mat('#f1f4f3'), blanketMats = ['#8fb5c9', '#9fc2b5', '#b7c4d9'].map((c) => mat(c));
  const patients = [];
  const bed = (x, z, dir, along = 'x') => {
    // dir: which way the head points (+1/-1) along the axis
    const g = new THREE.Group();
    const add = (geo, m, px, py, pz) => { const o = new THREE.Mesh(geo, m); o.position.set(px, py, pz); g.add(o); };
    add(new THREE.BoxGeometry(2.1, 0.1, 1.0), frameMat, 0, 0.45, 0);
    for (const sx of [-0.95, 0.95]) for (const sz of [-0.42, 0.42]) add(new THREE.BoxGeometry(0.05, 0.45, 0.05), frameMat, sx, 0.22, sz);
    add(new THREE.BoxGeometry(2.0, 0.18, 0.92), sheetMat, 0, 0.59, 0);
    add(new THREE.BoxGeometry(0.06, 0.8, 1.0), frameMat, dir * 1.05, 0.8, 0);
    add(new THREE.BoxGeometry(0.42, 0.13, 0.62), sheetMat, dir * 0.78, 0.74, 0);
    add(new THREE.BoxGeometry(1.25, 0.42, 0.98), pick(rng, blanketMats), -dir * 0.38, 0.84, 0);
    g.position.set(x, 0, z);
    if (along === 'z') g.rotation.y = Math.PI / 2;
    scene.add(g);
    // patient (feet at foot end, head on pillow)
    const feet = new THREE.Vector3(-dir * 0.95, 0.9, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), g.rotation.y).add(g.position);
    const headDir = new THREE.Vector3(dir, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), g.rotation.y);
    patients.push({
      x: feet.x, y: feet.y - 0.08, z: feet.z, ry: Math.atan2(-headDir.x, -headDir.z), s: 0.95,
      body: pick(rng, ['#a9c7d6', '#b6cfe0', '#c4d6cf']), legs: '#a9c7d6', skin: pick(rng, SKIN), phase: rng() * 9,
      pose: (p, t) => ({ lie: true, head: -0.25, headY: Math.sin(t * 0.3 + p.phase) * 0.15, aL: 0.12, aR: 0.12, bob: Math.sin(t * 1.4 + p.phase) * 0.01 }),
    });
  };
  for (let k = 0; k < 18; k++) {
    const z = 2 - k * 3.2;
    for (const side of [-1, 1]) {
      bed(side * 4.75, z, side);
      // wall monitor
      const mon = new THREE.Group();
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.72), mat('#2b3135'));
      const tex = ecg.clone(); tex.needsUpdate = true; tex.repeat.set(0.5, 1); tex.wrapS = THREE.RepeatWrapping;
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.4), new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(2.2, 2.2, 2.2) }));
      scr.position.x = -side * 0.065; scr.rotation.y = -side * Math.PI / 2;
      mon.add(box, scr); mon.position.set(side * 6.9, 1.9, z + 0.6); scene.add(mon);
      monitors.push({ tex, ph: rng() });
      // IV pole
      if (rng() < 0.6) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.1, 5), frameMat); pole.position.set(side * 6.2, 1.05, z - 0.7); scene.add(pole);
        const bag = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.26, 0.06), mat('#e9f5ff', { transparent: true, opacity: 0.85 })); bag.position.set(side * 6.2, 1.95, z - 0.62); scene.add(bag);
      }
    }
  }
  // overflow: stretchers down the aisle further in
  for (let k = 0; k < 12; k++) bed(k % 2 ? 1.25 : -1.25, -13 - k * 3.1, 1, 'z');
  // curtains
  const curtain = mat('#9cc3cf', { side: THREE.DoubleSide, transparent: true, opacity: 0.88 });
  for (let k = 0; k < 18; k += 2) for (const side of [-1, 1]) if (rng() < 0.6) {
    const c = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 2.6, 8, 1), curtain);
    const pos = c.geometry.attributes.position; for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * 9) * 0.06);
    c.geometry.computeVertexNormals();
    c.position.set(side * 5.6, 1.6, 2 - k * 3.2 - 1.6); scene.add(c);
  }
  // staff walking, visitors waiting
  const staff = [];
  for (let i = 0; i < 7; i++) {
    const toward = rng() < 0.5;
    const sx = pick(rng, [-2.6, 2.6, -0.1]), away = Math.abs(sx) < 1 || !toward;
    staff.push({ x: sx + range(rng, -0.3, 0.3), z: range(rng, -34, -14), ry: away ? Math.PI : 0, dir: away ? -1 : 1, s: 1, body: pick(rng, ['#2f8f8a', '#3a7ca5', '#2f8f8a']), legs: '#2f8f8a', skin: pick(rng, SKIN), hat: rng() < 0.4 ? 'beanie' : null, hatColor: '#2f8f8a', phase: rng() * 9,
      pose: (p, t) => ({ dz: p.dir * t * 0.7, fL: Math.sin(t * 5 + p.phase) * 0.35, fR: -Math.sin(t * 5 + p.phase) * 0.35, bob: Math.abs(Math.sin(t * 5 + p.phase)) * 0.03 }) });
  }
  for (let i = 0; i < 0; i++) {
    const side = i % 2 ? 1 : -1;
    staff.push({ x: side * 2.6, y: -0.25, z: -1.5 - i * 2.2, ry: -side * Math.PI / 2, s: 1, body: pick(rng, COATS), legs: '#2b2b30', skin: pick(rng, SKIN), phase: rng() * 9,
      pose: (p, t) => ({ sit: true, lean: 0.35, head: 0.45 + Math.sin(t * 0.6 + p.phase) * 0.05, fL: 0.7, fR: 0.7 }) });
    const chair = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.5), mat('#40565a')); chair.position.set(side * 2.75, 0.45, -1.5 - i * 2.2); scene.add(chair);
  }
  const crowd = new Crowd([...patients, ...staff]);
  scene.add(crowd.group);

  const rig = cameraRig(camera, [
    { p: [0, 3.1, 8], l: [-1, 0.9, -24] },
    { p: [-0.6, 2.5, 1], l: [-2.2, 0.9, -26] },
    { p: [-1.2, 2.1, -6], l: [-3.4, 0.8, -26] },
  ]);
  return {
    scene, camera, bloom: [0.45, 0.4, 0.82], exposure: 1.0,
    update(t, dur) {
      monitors.forEach((m) => { m.tex.offset.x = t * 0.35 + m.ph; });
      crowd.update(t);
      rig(t / dur, 0.03, t);
    },
  };
}

/* ============ 3. Cemetery: closed until further notice ============ */
export function cemetery() {
  const rng = rngFrom(33);
  const { scene, camera } = shell(gradientTexture([[0, '#7f8b98'], [0.5, '#c4c0b8'], [1, '#e0c4a0']]), '#c2beb4', 0.034);
  scene.add(new THREE.HemisphereLight('#d2d8e0', '#3e3a30', 1.0));
  const sun = new THREE.DirectionalLight('#ffd3a0', 2.0); sun.position.set(-20, 7, -40); scene.add(sun);

  const gg = new THREE.PlaneGeometry(140, 140, 50, 50); gg.rotateX(-Math.PI / 2);
  const gp = gg.attributes.position; for (let i = 0; i < gp.count; i++) gp.setY(i, Math.sin(gp.getX(i) * 0.3) * 0.12 + Math.cos(gp.getZ(i) * 0.25) * 0.12 + range(rng, -0.06, 0.06));
  const ground = new THREE.Mesh(gg.toNonIndexed(), mat('#58604a')); ground.position.z = -30; scene.add(ground);

  // grass tufts
  const NT = 2600; const tuft = new THREE.InstancedMesh(new THREE.ConeGeometry(0.05, 0.38, 3), mat('#ffffff'), NT);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(), col = new THREE.Color();
  for (let i = 0; i < NT; i++) {
    q.setFromEuler(e.set(range(rng, -0.3, 0.3), rng() * 6, range(rng, -0.3, 0.3)));
    m4.compose(p.set(range(rng, -22, 22), 0.15, range(rng, -50, 7)), q, s.setScalar(range(rng, 0.6, 1.4)));
    tuft.setMatrixAt(i, m4); tuft.setColorAt(i, col.set(pick(rng, ['#4d5a3a', '#6b6a44', '#3f4a33', '#7a7350'])));
  }
  scene.add(tuft);

  // gravestones
  const stoneMats = ['#8b8d8a', '#9a978f', '#7a7c7c', '#a8a399'].map((c) => mat(c));
  for (let r = 0; r < 9; r++) for (let x = -13; x <= 13; x += range(rng, 2.0, 2.8)) {
    if (Math.abs(x) < 1.5 && r < 3) continue;
    const z = -5 - r * 3.4 + range(rng, -0.4, 0.4);
    const g = new THREE.Group(); const m = pick(rng, stoneMats); const type = rng();
    if (type < 0.6) {
      const h = range(rng, 0.7, 1.1);
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.72, h, 0.16), m); b.position.y = h / 2; g.add(b);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.16, 10, 1, false, 0, Math.PI), m); top.rotation.order = 'ZYX'; top.rotation.set(Math.PI / 2, 0, Math.PI / 2); top.position.y = h; g.add(top);
    } else if (type < 0.85) {
      const v = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.4, 0.16), m); v.position.y = 0.7; g.add(v);
      const hb = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.16, 0.16), m); hb.position.y = 1.0; g.add(hb);
    } else {
      const o = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.28, 2.1, 4), m); o.position.y = 1.05; o.rotation.y = Math.PI / 4; g.add(o);
    }
    g.position.set(x, 0, z); g.rotation.set(range(rng, -0.08, 0.08), range(rng, -0.15, 0.15), range(rng, -0.08, 0.08));
    scene.add(g);
  }
  // trees
  for (const [x, z, h] of [[-9, -8, 9], [8, -14, 10], [-4, -30, 8], [14, -4, 8], [-16, -20, 11], [5, -36, 9]]) {
    const tr = bareTree(rngFrom(x * 7 + z), { height: h, depth: 5, color: '#2a2622', radius: 0.32 }); tr.position.set(x, 0, z); scene.add(tr);
  }
  // iron fence + closed gate
  const NF = 160; const bars = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 1.8, 0.05), mat('#16161a', { metalness: 0.6, roughness: 0.4 }), NF);
  const tips = new THREE.InstancedMesh(new THREE.ConeGeometry(0.05, 0.16, 4), mat('#16161a', { metalness: 0.6, roughness: 0.4 }), NF);
  let fi = 0; for (let x = -24; x <= 24 && fi < NF; x += 0.3) {
    const gate = Math.abs(x) < 1.7, h = gate ? 2.1 + Math.cos(x / 1.7 * Math.PI / 2) * 0.5 : 1.8;
    m4.compose(p.set(x, h / 2, 0), q.identity(), s.set(1, h / 1.8, 1)); bars.setMatrixAt(fi, m4);
    m4.compose(p.set(x, h + 0.08, 0), q.identity(), s.set(1, 1, 1)); tips.setMatrixAt(fi, m4); fi++;
  }
  bars.count = tips.count = fi; scene.add(bars, tips);
  for (const y of [0.35, 1.55]) { const rail = new THREE.Mesh(new THREE.BoxGeometry(48, 0.06, 0.06), mat('#16161a', { metalness: 0.6 })); rail.position.set(0, y, 0); scene.add(rail); }
  for (const x of [-1.85, 1.85]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.45, 2.9, 0.45), mat('#6f6b63')); post.position.set(x, 1.45, 0); scene.add(post); const cap = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 0), mat('#6f6b63')); cap.position.set(x, 3.05, 0); scene.add(cap); }
  const sign = canvasTexture(640, 256, (g, w, h) => {
    g.fillStyle = '#3b2b20'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 18; i++) { g.strokeStyle = `rgba(0,0,0,${0.15 + rng() * 0.2})`; g.lineWidth = 2; g.beginPath(); g.moveTo(0, rng() * h); g.lineTo(w, rng() * h); g.stroke(); }
    g.fillStyle = '#efe6d6'; g.textAlign = 'center'; g.font = '800 120px Inter'; g.fillText('CLOSED', w / 2, 140);
    g.font = '600 40px Inter'; g.fillText('UNTIL FURTHER NOTICE', w / 2, 210);
  });
  const signMesh = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.6, 0.04), [mat('#3b2b20'), mat('#3b2b20'), mat('#3b2b20'), mat('#3b2b20'), mat('#ffffff', { map: sign.tex }), mat('#3b2b20')]);
  signMesh.position.set(0.15, 1.2, 0.08); signMesh.rotation.z = -0.06; scene.add(signMesh);
  const chain = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.025, 4, 10), mat('#5d5a52', { metalness: 0.7 })); chain.position.set(0, 1.62, 0.06); scene.add(chain);

  // unused grave + idle gravedigger
  const hole = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.2), new THREE.MeshBasicMaterial({ color: '#0d0b09' })); hole.rotation.x = -Math.PI / 2; hole.position.set(3.4, 0.03, -11); hole.rotation.z = 0.2; scene.add(hole);
  const mound = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), mat('#4a3a2a')); mound.scale.set(0.9, 0.45, 1.4); mound.position.set(4.9, 0.1, -11.2); scene.add(mound);
  const shovel = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.4, 5), mat('#6b4a2c')); handle.position.y = 0.7; shovel.add(handle);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.3, 0.03), mat('#77797a', { metalness: 0.6 })); blade.position.y = -0.05; shovel.add(blade);
  shovel.position.set(4.1, 0.15, -10.1); shovel.rotation.z = 0.12; scene.add(shovel);
  const digger = new Crowd([{ x: 4.45, z: -10.05, ry: -0.9, s: 1, body: '#3d4a3a', legs: '#2a2a26', skin: '#c99a7a', hat: 'brim', hatColor: '#2a241e', phase: 0,
    pose: (p, t) => ({ lean: 0.25, head: 0.35 + Math.sin(t * 0.5) * 0.04, fR: 0.85, aR: -0.25, fL: 0.6, aL: -0.1, bob: Math.sin(t * 1.2) * 0.008 }) }]);
  scene.add(digger.group);

  // mist cards + dust
  const mist = [];
  const mistTex = spriteTexture();
  for (let i = 0; i < 9; i++) { const m = new THREE.Mesh(new THREE.PlaneGeometry(40, 5), new THREE.MeshBasicMaterial({ map: mistTex, color: '#e8e2d6', transparent: true, opacity: 0.32, depthWrite: false })); m.position.set(range(rng, -10, 10), range(rng, 0.4, 2), range(rng, -45, -6)); mist.push([m, rng() * 10]); scene.add(m); }
  const dust = drift(rng, 500, [-6, 6, 0, 4, -8, 6], { color: '#ffe2b0', size: 0.05, fall: 0.02, sway: 0.4, opacity: 0.7 });
  scene.add(dust);

  const rig = cameraRig(camera, [
    { p: [-4.2, 2.2, 11], l: [0.5, 1.0, -14] },
    { p: [-2.0, 1.8, 7], l: [0.4, 1.0, -14] },
    { p: [-0.6, 1.5, 4.2], l: [0.4, 1.0, -14] },
  ]);
  return {
    scene, camera, bloom: [0.35, 0.5, 0.85], exposure: 1.0,
    update(t, dur) {
      mist.forEach(([m, ph]) => { m.position.x += 0; m.position.x = Math.sin(t * 0.08 + ph) * 6; });
      dust.userData.update(t);
      digger.update(t);
      rig(t / dur, 0.03, t);
    },
  };
}

/* ============ 4. Crowded street at dusk ============ */
export function street() {
  const rng = rngFrom(44);
  const { scene, camera } = shell(gradientTexture([[0, '#0d1130'], [0.42, '#3a2c5b'], [0.72, '#b8566c'], [1, '#ffb36b']]), '#5a3f58', 0.011, 48);
  scene.add(new THREE.HemisphereLight('#8f86c9', '#2a1a1a', 1.15));
  const sun = new THREE.DirectionalLight('#ffb07a', 1.0); sun.position.set(0, 10, -100); scene.add(sun);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(40, 300), mat('#2a2930', { roughness: 0.6, metalness: 0.15 })); road.rotation.x = -Math.PI / 2; road.position.z = -120; scene.add(road);

  const facades = [0, 1, 2, 3].map(() => windowTexture(rng, { lit: 0.62 }));
  for (const side of [-1, 1]) {
    let z = 16;
    while (z > -260) {
      const w = range(rng, 10, 18), d = range(rng, 9, 16), h = range(rng, 28, 115);
      const b = building(w, h, d, pick(rng, facades), 1.4); b.position.set(side * (9.5 + w / 2), h / 2, z - d / 2); scene.add(b);
      z -= d + range(rng, 0.2, 1.5);
    }
  }
  const signs = [
    ['NO VACANCY', '#ff3b5c', -1, 7, -10, 3.8],
    ['HOUSING WAITLIST · 14 YRS', '#ffb02e', 1, 9, -20, 5],
    ['ROOMS: FULL', '#3ee0ff', -1, 11, -33, 4],
    ['SHARED BEDS · 6 PER ROOM', '#ff5fd2', 1, 6.5, -44, 4.2],
    ['NO VACANCY', '#ff3b5c', -1, 8, -58, 3.6],
    ['TENTS · $900/MO', '#9dff6b', 1, 10, -70, 3.8],
  ];
  for (const [txt, c, side, y, z, sc] of signs) {
    const { mesh } = neonSign(txt, { color: c, w: 1280, h: 256, font: '800 104px Inter' });
    mesh.scale.setScalar(sc); mesh.position.set(side * 9.4, y, z); mesh.rotation.y = -side * Math.PI / 2; scene.add(mesh);
    const l = new THREE.PointLight(c, 1.3, 18, 1.2); l.position.set(side * 7.5, y, z); scene.add(l);
  }
  // street lamps
  for (let z = 4; z > -120; z -= 14) for (const side of [-1, 1]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 5.5, 5), mat('#1b1b20')); pole.position.set(side * 8.6, 2.75, z); scene.add(pole);
    const bulb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 1), glow('#ffd59a', 4)); bulb.position.set(side * 8.2, 5.5, z); scene.add(bulb);
  }
  // shoulder-to-shoulder crowd
  const people = crowdGrid(rng, {
    x0: -8.6, x1: 8.6, z0: -95, z1: 9, gap: 0.74,
    skip: (x, z) => z > 4.5 && x > -0.5 && x < 3,
    make: (x, z) => {
      const toward = rng() < 0.5;
      return {
        x, z, ry: (toward ? 0 : Math.PI) + range(rng, -0.25, 0.25), dir: toward ? 1 : -1, s: range(rng, 0.88, 1.08),
        body: pick(rng, COATS), legs: pick(rng, ['#1b1c22', '#2a2d3a', '#3a2c22', '#4b4b55']), skin: pick(rng, SKIN),
        hat: rng() < 0.18 ? 'beanie' : rng() < 0.08 ? 'hood' : null, hatColor: pick(rng, COATS), phone: rng() < 0.08, phase: rng() * 10,
        pose: (p, t) => {
          const w = Math.sin(t * 3.6 + p.phase);
          if (p.phone) return { dz: p.dir * t * 0.25, fR: 1.3, aR: 0.1, head: 0.4, fL: w * 0.2 };
          return { dz: p.dir * t * 0.4, fL: w * 0.3, fR: -w * 0.3, bob: Math.abs(w) * 0.03, tilt: w * 0.02 };
        },
      };
    },
  });
  const crowd = new Crowd(people, { phoneGlow: 2.5 }); scene.add(crowd.group);

  const rig = cameraRig(camera, [
    { p: [1.3, 1.75, 7.5], l: [0.6, 1.8, -20] },
    { p: [0.8, 6, 9], l: [0, 2, -28] },
    { p: [0, 26, 16], l: [0, 0, -42] },
  ]);
  return {
    scene, camera, bloom: [0.85, 0.55, 0.68], exposure: 1.05,
    update(t, dur) { crowd.update(t); rig(t / dur, 0.05, t); },
  };
}
