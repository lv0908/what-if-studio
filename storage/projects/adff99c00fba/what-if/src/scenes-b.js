// Scenes 5-9: price board, aging park, ocean cities, rocket launch, leaving Earth.
import * as THREE from 'three';
import {
  rngFrom, clamp, lerp, smooth, easeInOut, easeOut, pick, range, cameraRig, mat, glow, canvasTexture,
  gradientTexture, spriteTexture, windowTexture, building, bareTree, drift, starField, Crowd, crowdGrid, SKIN, COATS,
} from './lib.js';
import { shell } from './scenes-a.js';

const AMBER = '#ffad2e', AMBER_HI = '#ffd889', RED = '#ff4a3a';
function ledOverlay(g, w, h, step = 6) {
  g.fillStyle = 'rgba(0,0,0,0.5)';
  for (let x = 0; x < w; x += step) g.fillRect(x, 0, 2, h);
  for (let y = 0; y < h; y += step) g.fillRect(0, y, w, 2);
}

/* ============ 5. Food price board ============ */
export function market() {
  const rng = rngFrom(55);
  const { scene, camera } = shell('#060302', '#150904', 0.03, 50);
  scene.add(new THREE.HemisphereLight('#ff9a4a', '#000000', 0.35));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), mat('#120a06', { roughness: 0.5, metalness: 0.3 })); floor.rotation.x = -Math.PI / 2; floor.position.z = -10; scene.add(floor);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(60, 30), mat('#0c0604')); wall.position.set(0, 15, -17); scene.add(wall);

  // main board
  const board = canvasTexture(1440, 810);
  const bm = new THREE.Mesh(new THREE.PlaneGeometry(13, 7.31), new THREE.MeshBasicMaterial({ map: board.tex, color: new THREE.Color(1.7, 1.7, 1.7) }));
  bm.position.set(0, 11, -16.5); scene.add(bm);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(13.5, 7.8, 0.3), mat('#1a1410', { metalness: 0.5 })); frame.position.set(0, 11, -16.7); scene.add(frame);
  const pts = []; const r2 = rngFrom(5);
  for (let i = 0; i <= 120; i++) { const u = i / 120; pts.push(Math.pow(u, 1.7) * 0.85 + (r2() - 0.5) * 0.05 + (u > 0.55 ? (u - 0.55) * 0.35 : 0)); }
  const drawBoard = (t, u) => board.redraw((g, w, h) => {
    g.fillStyle = '#0d0603'; g.fillRect(0, 0, w, h);
    g.fillStyle = AMBER; g.font = '700 52px "Space Mono"'; g.textAlign = 'left'; g.fillText('FOOD PRICE INDEX', 70, 105);
    g.fillStyle = 'rgba(255,173,46,.6)'; g.font = '700 40px "Space Mono"'; g.fillText('FPX', 640, 105);
    const sec = 17 + Math.floor(t); g.textAlign = 'right'; g.fillStyle = AMBER; g.fillText(`06:42:${String(sec).padStart(2, '0')}`, w - 70, 105);
    const val = lerp(196.4, 312.6, easeOut(u * 1.15)) + Math.sin(t * 9) * 0.3;
    g.textAlign = 'center'; g.fillStyle = AMBER_HI; g.shadowColor = AMBER; g.shadowBlur = 30;
    g.font = '700 200px "Space Mono"'; g.fillText(`▲+${val.toFixed(1)}%`, w / 2, 330); g.shadowBlur = 0;
    g.font = '700 38px "Space Mono"'; g.fillStyle = AMBER; g.fillText('WHEAT  RICE  MAIZE  SOY  WATER', w / 2, 400);
    // chart
    const x0 = 110, x1 = w - 200, y0 = h - 70, y1 = 450;
    g.strokeStyle = 'rgba(255,173,46,.35)'; g.lineWidth = 2; g.font = '700 26px "Space Mono"'; g.textAlign = 'left'; g.fillStyle = 'rgba(255,173,46,.7)';
    [0, 100, 200, 300].forEach((v, i) => { const y = lerp(y0, y1, i / 3); g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke(); g.fillText(`+${v}%`, x1 + 18, y + 9); });
    const n = Math.floor(lerp(30, 120, smooth(u * 1.1)));
    g.strokeStyle = AMBER_HI; g.lineWidth = 7; g.shadowColor = AMBER; g.shadowBlur = 18; g.beginPath();
    for (let i = 0; i <= n; i++) { const x = lerp(x0, x1, i / 120), y = lerp(y0, y1, pts[i]); i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke(); g.shadowBlur = 0;
    const ex = lerp(x0, x1, n / 120), ey = lerp(y0, y1, pts[n]);
    g.fillStyle = '#fff3d6'; g.beginPath(); g.arc(ex, ey, 12, 0, 7); g.fill();
    ledOverlay(g, w, h, 6);
  });

  const sidePanel = (lines, x, ry) => {
    const tx = canvasTexture(540, 900, (g, w, h) => {
      g.fillStyle = '#0d0603'; g.fillRect(0, 0, w, h);
      g.font = '700 46px "Space Mono"';
      lines.forEach(([name, val, up], i) => {
        const y = 110 + i * 130;
        g.textAlign = 'left'; g.fillStyle = AMBER; g.fillText(name, 40, y);
        g.textAlign = 'right'; g.fillStyle = up ? AMBER_HI : RED; g.fillText(`${up ? '▲' : '▼'}${val}`, w - 40, y);
        g.strokeStyle = up ? AMBER : RED; g.lineWidth = 4; g.beginPath();
        for (let k = 0; k < 20; k++) { const xx = 40 + k * 23, yy = y + 50 - (up ? k * 1.6 : -k * 1.2) + Math.sin(k * 1.7 + i) * 5; k ? g.lineTo(xx, yy) : g.moveTo(xx, yy); } g.stroke();
      });
      ledOverlay(g, w, h, 6);
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 9), new THREE.MeshBasicMaterial({ map: tx.tex, color: new THREE.Color(1.5, 1.5, 1.5) }));
    m.position.set(x, 10, -14.5); m.rotation.y = ry; scene.add(m);
  };
  sidePanel([['WHEAT', '288%', 1], ['RICE', '341%', 1], ['MAIZE', '267%', 1], ['SOY', '302%', 1], ['HARVEST', '-38%', 0], ['STOCKS', '-61%', 0]], -10.6, 0.55);
  sidePanel([['WATER', '905%', 1], ['BREAD', '214%', 1], ['EGGS', '256%', 1], ['MILK', '231%', 1], ['FARMLAND', '-22%', 0], ['RESERVES', '-74%', 0]], 10.6, -0.55);

  const ticker = canvasTexture(4096, 128, (g, w, h) => {
    g.fillStyle = '#0d0603'; g.fillRect(0, 0, w, h); g.font = '700 74px "Space Mono"'; g.fillStyle = AMBER; g.textBaseline = 'middle';
    g.fillText('WATER ▲905.7%   RICE ▲341.0%   SOY ▲302.2%   WHEAT ▲288.4%   MAIZE ▲267.9%   SUGAR ▲221.5%   COFFEE ▲188.3%   ', 10, h / 2 + 4);
    ledOverlay(g, w, h, 6);
  });
  ticker.tex.wrapS = THREE.RepeatWrapping; ticker.tex.repeat.set(0.55, 1);
  const tk = new THREE.Mesh(new THREE.PlaneGeometry(34, 1.5), new THREE.MeshBasicMaterial({ map: ticker.tex, color: new THREE.Color(1.6, 1.6, 1.6) }));
  tk.position.set(0, 15.6, -16.4); scene.add(tk);

  // trading floor
  const monTex = [
    canvasTexture(256, 160, (g, w, h) => { g.fillStyle = '#100703'; g.fillRect(0, 0, w, h); g.strokeStyle = AMBER; g.lineWidth = 4; g.beginPath(); for (let i = 0; i < 30; i++) { const x = 12 + i * 8, y = h - 20 - i * i * 0.13 + Math.sin(i) * 4; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); g.fillStyle = AMBER_HI; g.font = '700 28px "Space Mono"'; g.fillText('+288%', 12, 34); }),
    canvasTexture(256, 160, (g, w, h) => { g.fillStyle = '#100703'; g.fillRect(0, 0, w, h); g.font = '700 18px "Space Mono"'; for (let i = 0; i < 7; i++) { g.fillStyle = i % 3 ? AMBER : RED; g.fillText(['WHT', 'RCE', 'SOY', 'H2O', 'MZE', 'SGR', 'CFE'][i] + '  ▲' + (180 + i * 37) + '%', 12, 24 + i * 20); } }),
    canvasTexture(256, 160, (g, w, h) => { g.fillStyle = '#2a0703'; g.fillRect(0, 0, w, h); g.fillStyle = RED; g.font = '700 30px "Space Mono"'; g.textAlign = 'center'; g.fillText('SUPPLY', w / 2, 70); g.fillText('ALERT', w / 2, 108); }),
  ].map((c) => new THREE.MeshBasicMaterial({ map: c.tex, color: new THREE.Color(1.8, 1.8, 1.8) }));
  const deskMat = mat('#1d1510', { roughness: 0.6 }), monMat = mat('#0b0908');
  const people = [];
  for (let r = 0; r < 7; r++) {
    const z = 8 - r * 2.7;
    for (let x = -9; x <= 9; x += 2.25) {
      const desk = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.06, 0.85), deskMat); desk.position.set(x, 0.76, z); scene.add(desk);
      const pan = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.7, 0.04), deskMat); pan.position.set(x, 0.4, z - 0.42); scene.add(pan);
      for (const dx of [-0.42, 0.42]) {
        const mon = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.42, 0.04), monMat); mon.position.set(x + dx, 1.15, z - 0.25); scene.add(mon);
        const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.38), pick(rng, monTex)); scr.position.set(x + dx, 1.15, z - 0.228); scr.rotation.y = Math.PI; scene.add(scr);
        const scrF = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.38), pick(rng, monTex)); scrF.position.set(x + dx, 1.15, z - 0.272); scene.add(scrF);
      }
      if (rng() < 0.75) {
        const stand = rng() < 0.3;
        people.push({ x: x + range(rng, -0.3, 0.3), y: stand ? 0 : -0.27, z: z + 0.55, ry: Math.PI + range(rng, -0.2, 0.2), s: 1, body: pick(rng, ['#1d1a18', '#2a2420', '#16181c', '#30261e', '#e9e1d4']), legs: '#14110f', skin: pick(rng, SKIN), phase: rng() * 9, stand, kind: rng(),
          pose: (p, t) => {
            if (p.stand) return p.kind < 0.5
              ? { aL: 2.75, aR: 2.75, fL: 0.5, fR: 0.5, head: -0.15 + Math.sin(t * 0.8 + p.phase) * 0.08 }
              : { fR: 1.6 + Math.sin(t * 3 + p.phase) * 0.15, aR: 0.2, fL: 0.2, head: -0.2, turn: Math.sin(t * 0.7 + p.phase) * 0.3 };
            return { sit: true, lean: 0.25 + Math.sin(t * 0.9 + p.phase) * 0.05, fL: 1.0, fR: 1.0, head: 0.1 };
          } });
      }
    }
  }
  const crowd = new Crowd(people); scene.add(crowd.group);
  const bl = new THREE.PointLight('#ff9a3c', 2.2, 40, 1); bl.position.set(0, 9, -10); scene.add(bl);
  const rig = cameraRig(camera, [
    { p: [0, 4.8, 21], l: [0, 4.6, -16] },
    { p: [0, 4.2, 15], l: [0, 4.9, -16] },
    { p: [0, 3.8, 10.5], l: [0, 5.2, -16] },
  ]);
  return {
    scene, camera, bloom: [1.0, 0.65, 0.55], exposure: 1.0,
    update(t, dur) {
      drawBoard(t, t / dur);
      ticker.tex.offset.x = t * 0.06;
      bl.intensity = 2.2 + Math.sin(t * 13) * 0.15;
      crowd.update(t);
      rig(t / dur, 0.04, t);
    },
  };
}

/* ============ 6. Winter park: everyone grows very old ============ */
export function park() {
  const rng = rngFrom(66);
  const { scene, camera } = shell(gradientTexture([[0, '#1a2130'], [0.65, '#4a5566'], [1, '#7d808a']]), '#4f5868', 0.042, 46);
  scene.add(new THREE.HemisphereLight('#a5b8d2', '#2a2a30', 1.05));
  const moon = new THREE.DirectionalLight('#b9c8e8', 0.7); moon.position.set(10, 20, 10); scene.add(moon);
  const gg = new THREE.PlaneGeometry(120, 120, 40, 40); gg.rotateX(-Math.PI / 2);
  const gp = gg.attributes.position; for (let i = 0; i < gp.count; i++) gp.setY(i, range(rng, -0.05, 0.08));
  const ground = new THREE.Mesh(gg.toNonIndexed(), mat('#b4bdc8', { roughness: 1 })); ground.position.z = -20; scene.add(ground);
  const path = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 120), mat('#6d7480')); path.rotation.x = -Math.PI / 2; path.position.set(0, 0.04, -40); scene.add(path);
  // background blocks
  const fac = windowTexture(rng, { lit: 0.35, wall: '#262b35' });
  for (let i = 0; i < 9; i++) { const h = range(rng, 18, 40); const b = building(range(rng, 14, 24), h, 10, fac, 0.9); b.position.set(-48 + i * 12, h / 2, -55 - rng() * 8); scene.add(b); }

  const benchMat = mat('#4a3426'), ironMat = mat('#1a1b1f');
  const people = [];
  const elder = (o) => ({ s: 0.95, body: pick(rng, ['#3b3a44', '#5a4b3c', '#2d3b4a', '#6b5a4a', '#4a2f33', '#3f4a3c']), legs: pick(rng, ['#2a2a2e', '#3a3530']), skin: pick(rng, SKIN),
    hat: rng() < 0.55 ? pick(rng, ['beanie', 'brim', 'hood']) : null, hatColor: pick(rng, ['#8a2f2f', '#2f4a6a', '#5a5a5a', '#c7a14a', '#d9d4cc']), phase: rng() * 9, ...o });
  for (let k = 0; k < 6; k++) for (const side of [-1, 1]) {
    const z = 3 - k * 4.6, x = side * 3.3;
    const g = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.07, 2.3), benchMat); seat.position.y = 0.46; g.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 2.3), benchMat); back.position.set(side * 0.26, 0.82, 0); back.rotation.z = side * 0.12; g.add(back);
    for (const dz of [-1, 1]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.46, 0.06), ironMat); leg.position.set(0, 0.23, dz * 1.0); g.add(leg); }
    const snowcap = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 2.3), mat('#e6ecf2')); snowcap.position.set(side * 0.29, 1.08, 0); g.add(snowcap);
    g.position.set(x, 0, z); scene.add(g);
    const n = rng() < 0.3 ? 2 : 3;
    for (let j = 0; j < n; j++) people.push(elder({ x: x + side * 0.12, y: -0.25, z: z + (j - (n - 1) / 2) * 0.72, ry: -side * Math.PI / 2,
      pose: (p, t) => ({ sit: true, lean: 0.38 + Math.sin(t * 0.8 + p.phase) * 0.03, head: 0.5, fL: 0.75, fR: 0.75, aL: 0.15, aR: 0.15, bob: Math.sin(t * 1.1 + p.phase) * 0.006 }) }));
  }
  for (let i = 0; i < 9; i++) {
    const toward = rng() < 0.5;
    people.push(elder({ x: range(rng, -1.4, 1.4), z: range(rng, -26, -6), ry: toward ? 0 : Math.PI, dir: toward ? 1 : -1, cane: true,
      pose: (p, t) => ({ dz: p.dir * t * 0.22, lean: 0.45, head: 0.25, fR: 0.35, aR: 0.12, fL: 0.2 + Math.sin(t * 2 + p.phase) * 0.08, bob: Math.abs(Math.sin(t * 2 + p.phase)) * 0.015, tilt: Math.sin(t * 2 + p.phase) * 0.04 }) }));
  }
  // a few standing in quiet groups
  for (let i = 0; i < 6; i++) people.push(elder({ x: range(rng, 5.5, 9) * (i % 2 ? 1 : -1), z: range(rng, -20, -2), ry: rng() * 6, cane: rng() < 0.5,
    pose: (p, t) => ({ lean: 0.4, head: 0.3, fR: 0.3, fL: 0.25, headY: Math.sin(t * 0.4 + p.phase) * 0.3 }) }));
  const crowd = new Crowd(people); scene.add(crowd.group);

  for (let k = 0; k < 5; k++) for (const side of [-1, 1]) {
    const z = 5 - k * 9 + (side > 0 ? 4 : 0);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 3.6, 6), ironMat); pole.position.set(side * 4.7, 1.8, z); scene.add(pole);
    const lamp = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 1), glow('#ffcf8a', 4.5)); lamp.position.set(side * 4.7, 3.7, z); scene.add(lamp);
    if (k < 3) { const l = new THREE.PointLight('#ffbf70', 2.2, 11, 1.4); l.position.set(side * 4.7, 3.4, z); scene.add(l); }
  }
  for (const [x, z, h] of [[-8, -4, 8], [7.5, -9, 9], [-10, -16, 10], [9, -22, 8], [-7, -30, 9], [11, 2, 7], [-12, 4, 8]]) {
    const tr = bareTree(rngFrom(x * 13 + z), { height: h, depth: 5, color: '#1f2026', radius: 0.3 }); tr.position.set(x, 0, z); scene.add(tr);
  }
  const snow = drift(rng, 1600, [-14, 14, 0, 14, -34, 12], { color: '#ffffff', size: 0.07, fall: 0.9, sway: 0.35, opacity: 0.9, additive: false });
  scene.add(snow);
  const rig = cameraRig(camera, [
    { p: [-6.5, 3.1, 4], l: [0, 1.0, -9] },
    { p: [-1.6, 2.3, 2.2], l: [0.4, 1.0, -9] },
    { p: [1.1, 2.0, 1.2], l: [0, 0.9, -10] },
  ]);
  return {
    scene, camera, bloom: [0.6, 0.5, 0.78], exposure: 1.0,
    update(t, dur) { snow.userData.update(t); crowd.update(t); rig(t / dur, 0.03, t); },
  };
}

/* ============ 7. Cities on the ocean ============ */
export function ocean() {
  const rng = rngFrom(77);
  const { scene, camera } = shell(gradientTexture([[0, '#141a3f'], [0.4, '#4a3b6e'], [0.62, '#d9705a'], [0.78, '#ffb36e'], [1, '#ffd9a0']]), '#a8627a', 0.0019, 42);
  scene.add(new THREE.HemisphereLight('#8f7fc4', '#203048', 0.8));
  const sunDir = new THREE.Vector3(40, 22, -380);
  const sunL = new THREE.DirectionalLight('#ffb27a', 1.5); sunL.position.copy(sunDir.clone().normalize().multiplyScalar(100)); scene.add(sunL);
  const sun = new THREE.Mesh(new THREE.CircleGeometry(24, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffe2b0').multiplyScalar(3), fog: false })); sun.position.copy(sunDir); scene.add(sun);

  const og = new THREE.PlaneGeometry(700, 700, 120, 120); og.rotateX(-Math.PI / 2);
  const sea = og.toNonIndexed(); const sp = sea.attributes.position; const base = Float32Array.from(sp.array);
  const skyEnv = gradientTexture([[0, '#141a3f'], [0.35, '#4a3b6e'], [0.48, '#d9705a'], [0.5, '#ffb36e'], [0.52, '#20283f'], [1, '#0a0e1c']]);
  skyEnv.mapping = THREE.EquirectangularReflectionMapping;
  const water = new THREE.Mesh(sea, mat('#2a4f74', { roughness: 0.28, metalness: 0.65, envMap: skyEnv, envMapIntensity: 1.1 })); water.position.z = -200; water.frustumCulled = false; scene.add(water);
  const wave = (x, z, t) => 0.55 * Math.sin(x * 0.07 + t * 0.9) + 0.4 * Math.sin(z * 0.1 - t * 1.1 + x * 0.03) + 0.22 * Math.sin((x + z) * 0.21 + t * 1.6);
  const updateSea = (t) => { for (let i = 0; i < sp.count; i++) { const x = base[i * 3], z = base[i * 3 + 2] - 200; sp.array[i * 3 + 1] = wave(x, z, t); } sp.needsUpdate = true; };

  const facs = [0, 1, 2].map(() => windowTexture(rng, { lit: 0.55, wall: '#2a2a35' }));
  const deck = mat('#8f887d'), rim = glow('#ffd59a', 1.4);
  const platforms = [];
  const spots = [[0, -70, 18], [-50, -120, 16], [45, -140, 20], [-12, -190, 22], [75, -90, 13], [-85, -70, 12], [25, -250, 24], [-60, -230, 18], [95, -200, 16]];
  for (const [x, z, r] of spots) {
    const g = new THREE.Group();
    const pl = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.05, 3, 6), deck); pl.position.y = 0.5; g.add(pl);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 1.0, 0.18, 4, 6), rim); ring.rotation.x = Math.PI / 2; ring.rotation.z = Math.PI / 6; ring.position.y = 2.05; g.add(ring);
    const n = Math.floor(r * 0.7);
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2, d = Math.sqrt(rng()) * r * 0.7, h = range(rng, 8, 16) + (1 - d / r) * range(rng, 10, 45);
      let b;
      if (rng() < 0.75) b = building(range(rng, 3, 6), h, range(rng, 3, 6), pick(rng, facs), 1.5);
      else { b = new THREE.Mesh(new THREE.CylinderGeometry(range(rng, 1.5, 2.6), range(rng, 2.4, 3.2), h, 8), new THREE.MeshStandardMaterial({ map: pick(rng, facs), emissiveMap: pick(rng, facs), emissive: '#ffffff', emissiveIntensity: 1.3, flatShading: true })); b.position.y = h / 2; }
      b.position.x = Math.cos(a) * d; b.position.z = Math.sin(a) * d; b.position.y += 2; g.add(b);
      if (rng() < 0.4) { const beacon = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35, 0), glow('#ff3b3b', 4)); beacon.position.set(b.position.x, h + 2.4, b.position.z); g.add(beacon); }
    }
    g.position.set(x, 0, z); scene.add(g); platforms.push([g, rng() * 6]);
  }
  // bridges between nearby platforms
  for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) {
    const [ax, az, ar] = spots[i], [bx, bz, br] = spots[j];
    const d = Math.hypot(bx - ax, bz - az); if (d > 75) continue;
    const len = d - ar - br; if (len < 2) continue;
    const br2 = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, len), deck);
    const mx = ax + (bx - ax) * (ar + len / 2) / d, mz = az + (bz - az) * (ar + len / 2) / d;
    br2.position.set(mx, 2.3, mz); br2.rotation.y = Math.atan2(bx - ax, bz - az); scene.add(br2);
    const lights = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, len), rim); lights.position.set(mx, 2.65, mz); lights.rotation.y = br2.rotation.y; scene.add(lights);
  }
  // boats
  const boats = [];
  for (let i = 0; i < 10; i++) {
    const b = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.8, 5), mat('#e9e4da')); b.add(hull);
    const bow = new THREE.Mesh(new THREE.ConeGeometry(0.8, 1.6, 4), mat('#e9e4da')); bow.rotation.x = Math.PI / 2; bow.rotation.y = Math.PI / 4; bow.position.z = 3.2; bow.scale.set(1, 1, 0.55); b.add(bow);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.8, 1.6), mat('#3b4a5a')); cab.position.set(0, 0.7, -0.6); b.add(cab);
    const x = range(rng, -60, 60), z = range(rng, -160, -20);
    b.position.set(x, 0, z); b.rotation.y = rng() * Math.PI * 2; scene.add(b); boats.push([b, x, z, b.rotation.y, range(rng, 2, 5)]);
  }
  const rig = cameraRig(camera, [
    { p: [-50, 34, 70], l: [0, 4, -120] },
    { p: [-28, 28, 42], l: [8, 6, -135] },
    { p: [-6, 24, 22], l: [12, 8, -150] },
  ]);
  return {
    scene, camera, bloom: [0.6, 0.5, 0.72], exposure: 1.1,
    update(t, dur) {
      updateSea(t);
      platforms.forEach(([g, ph]) => { g.position.y = Math.sin(t * 0.6 + ph) * 0.15; });
      boats.forEach(([b, x, z, ry, v]) => { b.position.set(x + Math.sin(ry) * v * t, wave(x, z, t) + 0.1, z + Math.cos(ry) * v * t); b.rotation.z = Math.sin(t * 1.3 + x) * 0.05; });
      rig(t / dur, 0.1, t);
    },
  };
}

/* ============ 8. Rocket launch ============ */
export function launch() {
  const rng = rngFrom(88);
  const { scene, camera } = shell(gradientTexture([[0, '#02030a'], [0.65, '#0a1230'], [1, '#1e2645']]), '#0b1022', 0.0055, 50);
  scene.add(starField(rng, 2500, 600, 1.6));
  const hemi = new THREE.HemisphereLight('#3a4a7a', '#06070b', 0.6); scene.add(hemi);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600, 30, 30).rotateX(-Math.PI / 2).toNonIndexed(), mat('#15171d')); ground.position.z = -150; scene.add(ground);
  for (let i = 0; i < 14; i++) { const h = new THREE.Mesh(new THREE.ConeGeometry(range(rng, 30, 70), range(rng, 12, 30), 5), mat('#0d0f16')); h.position.set(range(rng, -260, 260), 0, range(rng, -300, -200)); scene.add(h); }

  const PAD = new THREE.Vector3(0, 0, -70);
  const pad = new THREE.Mesh(new THREE.BoxGeometry(24, 2, 24), mat('#3a3c42')); pad.position.copy(PAD).y = 1; scene.add(pad);
  // tower
  const tw = new THREE.Group(); const steel = mat('#5a2a20', { metalness: 0.4 });
  for (const [x, z] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) { const c = new THREE.Mesh(new THREE.BoxGeometry(0.4, 52, 0.4), steel); c.position.set(x, 26, z); tw.add(c); }
  for (let y = 2; y < 52; y += 3.2) for (const [w, d, x, z] of [[4.4, 0.25, 0, -2], [4.4, 0.25, 0, 2], [0.25, 4.4, -2, 0], [0.25, 4.4, 2, 0]]) { const r = new THREE.Mesh(new THREE.BoxGeometry(w, 0.25, d), steel); r.position.set(x, y, z); tw.add(r); }
  const beacon = new THREE.Mesh(new THREE.IcosahedronGeometry(0.6, 1), glow('#ff2020', 5)); beacon.position.y = 53; tw.add(beacon);
  for (const y of [18, 34]) { const arm = new THREE.Mesh(new THREE.BoxGeometry(6, 0.6, 1), steel); arm.position.set(4.5, y, 0); tw.add(arm); }
  tw.position.set(PAD.x - 8, 2, PAD.z); scene.add(tw);
  const floods = [];
  for (const [x, z] of [[-30, -40], [30, -45], [-28, -100], [30, -95]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 14, 5), mat('#22242a')); pole.position.set(x, 7, z); scene.add(pole);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 0.4), glow('#e8f0ff', 5)); lamp.position.set(x, 14, z); lamp.lookAt(PAD.x, 10, PAD.z); scene.add(lamp);
    const sl = new THREE.SpotLight('#dfe8ff', 12, 120, 0.45, 0.6, 1); sl.position.set(x, 14, z); sl.target.position.set(PAD.x, 14, PAD.z); scene.add(sl, sl.target); floods.push(sl);
  }
  // rocket
  const rocket = new THREE.Group(); const white = mat('#ecebe8', { roughness: 0.5 }), black = mat('#1a1a1e');
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 30, 12), white); body.position.y = 17; rocket.add(body);
  for (const y of [9, 24]) { const band = new THREE.Mesh(new THREE.CylinderGeometry(1.72, 1.72, 1.4, 12), black); band.position.y = y; rocket.add(band); }
  const upper = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.7, 6, 12), white); upper.position.y = 35; rocket.add(upper);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(1.4, 6, 12), white); nose.position.y = 41; rocket.add(nose);
  for (let i = 0; i < 4; i++) { const fin = new THREE.Mesh(new THREE.BoxGeometry(0.25, 4, 2.6), black); const a = i * Math.PI / 2; fin.position.set(Math.cos(a) * 1.9, 3.8, Math.sin(a) * 1.9); fin.rotation.y = -a; rocket.add(fin); }
  const bell = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.5, 1.8, 10, 1, true), mat('#2a2a2e', { side: THREE.DoubleSide })); bell.position.y = 1.2; rocket.add(bell);
  const flame = new THREE.Group();
  const outer = new THREE.Mesh(new THREE.ConeGeometry(1.7, 14, 12, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff7a1a').multiplyScalar(3.5), transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  outer.rotation.x = Math.PI; outer.position.y = -7; flame.add(outer);
  const inner = new THREE.Mesh(new THREE.ConeGeometry(1.0, 8, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff4cc').multiplyScalar(6) }));
  inner.rotation.x = Math.PI; inner.position.y = -4; flame.add(inner);
  flame.position.y = 0.4; rocket.add(flame);
  rocket.position.set(PAD.x, 2, PAD.z); scene.add(rocket);
  const fireL = new THREE.PointLight('#ff9440', 0, 220, 1.0); scene.add(fireL);

  const IGN = 1.0, LIFT = 2.4, ACC = 6.5;
  const rocketY = (t) => (t < LIFT ? 0 : 0.5 * ACC * (t - LIFT) ** 2);

  // smoke
  const NS = 360;
  const smoke = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), mat('#cfc8c0', { roughness: 1, emissive: '#4a2c18', emissiveIntensity: 0 }), NS);
  smoke.frustumCulled = false; scene.add(smoke);
  const sd = [];
  for (let i = 0; i < NS; i++) { const ts = IGN + 0.15 + (i / NS) * 6.8; sd.push({ ts, a: rng() * Math.PI * 2, v: range(rng, 5, 13), up: range(rng, 0.2, 1.4), sc: range(rng, 0.8, 1.4), trail: ts > LIFT + 0.6, jx: range(rng, -1.5, 1.5), jz: range(rng, -1.5, 1.5) }); }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pv = new THREE.Vector3(), sv = new THREE.Vector3();
  const updateSmoke = (t) => {
    sd.forEach((d, i) => {
      const age = t - d.ts;
      if (age < 0) { m4.makeScale(0, 0, 0); smoke.setMatrixAt(i, m4); return; }
      if (!d.trail) {
        const r = d.v * (1 - Math.exp(-age * 0.7)) * 2.2;
        pv.set(PAD.x + Math.cos(d.a) * r, 2 + d.up * age * 1.4 + 1, PAD.z + Math.sin(d.a) * r * 0.7);
        sv.setScalar((1.6 + age * 1.5) * d.sc);
      } else {
        const y0 = rocketY(d.ts) + 1;
        pv.set(PAD.x + d.jx * (1 + age), y0 + 2 - age * 1.2, PAD.z + d.jz * (1 + age));
        sv.setScalar((1.0 + age * 1.1) * d.sc);
      }
      m4.compose(pv, q, sv); smoke.setMatrixAt(i, m4);
    });
    smoke.instanceMatrix.needsUpdate = true;
  };
  // spectators on the ridge
  const people = crowdGrid(rng, {
    x0: -11, x1: 11, z0: 6, z1: 13, gap: 1.05, skip: (x, z) => Math.abs(x - 1) < 1.3 && z > 10.5,
    make: (x, z) => ({ x, z, ry: Math.PI + range(rng, -0.3, 0.3), s: range(rng, 0.9, 1.06), body: pick(rng, ['#14161c', '#1b1d24', '#22252d', '#2a2224']), legs: '#0d0e12', skin: pick(rng, ['#3a2d26', '#2d241f', '#4a3a30']), hat: rng() < 0.2 ? 'beanie' : null, hatColor: '#15171c', phone: rng() < 0.35, phase: rng() * 9,
      pose: (p, t) => { const look = -(0.15 + 0.5 * smooth((t - LIFT) / 4)); return p.phone ? { fR: 2.3 + Math.sin(t + p.phase) * 0.05, aR: 0.1, head: look } : { head: look, fL: 0.1, fR: 0.1, aL: 0.1, aR: 0.1 }; } }),
  });
  const crowd = new Crowd(people, { phoneGlow: 1.4 }); scene.add(crowd.group);

  return {
    scene, camera, bloom: [1.25, 0.7, 0.58], exposure: 1.0,
    update(t, dur) {
      const y = rocketY(t);
      rocket.position.y = 2 + y;
      const on = smooth((t - IGN) / 0.6), fl = 0.85 + 0.15 * Math.sin(t * 47) * Math.sin(t * 31);
      flame.scale.set(on * fl, on * (1 + 0.6 * smooth((t - LIFT) / 2)) * fl, on * fl);
      flame.visible = on > 0.01;
      fireL.position.set(PAD.x, rocket.position.y - 2, PAD.z + 4);
      fireL.intensity = on * 9 * fl;
      hemi.intensity = 0.6 + on * 0.5; smoke.material.emissiveIntensity = on * fl * 1.6;
      beacon.material.color.setRGB(Math.floor(t * 1.5) % 2 ? 5 : 0.4, 0, 0);
      updateSmoke(t); crowd.update(t);
      const u = t / dur;
      camera.position.set(lerp(2.2, 0.4, easeInOut(u)), lerp(1.7, 1.2, u), lerp(19, 16.5, easeInOut(u)));
      camera.position.x += Math.sin(t * 23) * 0.02 * on; camera.position.y += Math.sin(t * 29) * 0.02 * on;
      camera.lookAt(PAD.x, lerp(14, 24, smooth(u)) + y * 0.8, PAD.z);
    },
  };
}

/* ============ 9. Earth: so we leave ============ */
export function earth() {
  const rng = rngFrom(99);
  const { scene, camera } = shell('#000005', null, 0, 40);
  scene.add(starField(rng, 3000, 700, 1.5));
  scene.add(new THREE.AmbientLight('#203050', 0.35));
  const sun = new THREE.DirectionalLight('#fff3e0', 2.8); sun.position.set(40, 12, 25); scene.add(sun);
  const R = 10;
  const noise = (x, y, z) => Math.sin(x * 0.55 + 1.3) * Math.cos(y * 0.62 - 0.4) + Math.sin(z * 0.5 + y * 0.31 + 2.1) * 0.8 + Math.sin(x * 1.1 - z * 0.9) * 0.5 + Math.cos(y * 1.7 + x * 0.8) * 0.3 + Math.sin(z * 2.3 + x * 1.9) * 0.2 - 0.2;
  const geo = new THREE.IcosahedronGeometry(R, 22);
  const pos = geo.attributes.position, colors = new Float32Array(pos.count * 3), v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i); const e = noise(v.x, v.y, v.z); if (e > 0.35) v.multiplyScalar(1 + (e - 0.35) * 0.025); pos.setXYZ(i, v.x, v.y, v.z); }
  const c = new THREE.Color(), cen = new THREE.Vector3();
  for (let f = 0; f < pos.count; f += 3) {
    cen.set(0, 0, 0); for (let k = 0; k < 3; k++) cen.add(v.fromBufferAttribute(pos, f + k)); cen.divideScalar(3);
    const e = noise(cen.x, cen.y, cen.z), lat = Math.abs(cen.y) / R;
    if (lat > 0.88) c.set('#e9eef2');
    else if (e > 0.95) c.set('#8a7a5a'); else if (e > 0.6) c.set('#5b7f3a'); else if (e > 0.35) c.set('#3f7a3a');
    else if (e > 0.2) c.set('#2c6fa3'); else c.set('#173f74');
    for (let k = 0; k < 3; k++) colors.set([c.r, c.g, c.b], (f + k) * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const planet = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8 }));
  // city lights on land (night side glow)
  const lightPts = [];
  for (let f = 0; f < pos.count; f += 3) { cen.set(0, 0, 0); for (let k = 0; k < 3; k++) cen.add(v.fromBufferAttribute(pos, f + k)); cen.divideScalar(3); const e = noise(cen.x, cen.y, cen.z); if (e > 0.4 && e < 0.95 && Math.abs(cen.y) < 8 && rng() < 0.35) lightPts.push(cen.clone().multiplyScalar(1.004)); }
  const lg = new THREE.BufferGeometry().setFromPoints(lightPts);
  const city = new THREE.Points(lg, new THREE.PointsMaterial({ color: new THREE.Color('#ffc46b').multiplyScalar(1.6), size: 0.09, map: spriteTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  planet.add(city);
  // clouds
  const cg = new THREE.IcosahedronGeometry(R * 1.03, 30); const cpos = cg.attributes.position; const keep = [];
  for (let f = 0; f < cpos.count; f += 3) { cen.set(0, 0, 0); for (let k = 0; k < 3; k++) cen.add(v.fromBufferAttribute(cpos, f + k)); cen.divideScalar(3); const n2 = Math.sin(cen.x * 1.7 + cen.z * 0.6) * Math.cos(cen.y * 1.9 - cen.x * 0.4) + Math.sin(cen.z * 2.6 + cen.y * 1.1) * 0.5 + Math.sin(cen.x * 4.1) * 0.25; if (n2 > 0.95) for (let k = 0; k < 3; k++) keep.push(cpos.getX(f + k), cpos.getY(f + k), cpos.getZ(f + k)); }
  const cgeo = new THREE.BufferGeometry(); cgeo.setAttribute('position', new THREE.Float32BufferAttribute(keep, 3)); cgeo.computeVertexNormals();
  const clouds = new THREE.Mesh(cgeo, new THREE.MeshStandardMaterial({ color: '#ffffff', transparent: true, opacity: 0.6, flatShading: true }));
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.12, 64, 64), new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }',
    fragmentShader: 'varying vec3 vN; varying vec3 vV; void main(){ float i = pow(clamp(0.78 + dot(vN, vV), 0.0, 1.0), 4.0); gl_FragColor = vec4(vec3(0.35,0.62,1.0)*i*1.6, i); }',
  }));
  const world = new THREE.Group(); world.add(planet); world.rotation.z = 0.35; scene.add(world, atmo);

  // ships leaving
  const ships = [];
  for (let i = 0; i < 26; i++) {
    const dir = new THREE.Vector3(range(rng, -1, 1), range(rng, -0.6, 1), range(rng, 0.2, 1)).normalize();
    const ts = range(rng, 0.2, 5.5);
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.045, 0), glow('#fff2d0', 3));
    const lg2 = new THREE.BufferGeometry(); lg2.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    lg2.setAttribute('color', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1.6, 1.3, 0.9]), 3));
    const line = new THREE.Line(lg2, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending }));
    line.frustumCulled = false;
    scene.add(head, line); ships.push({ dir, ts, head, line, acc: range(rng, 1.2, 2.4) });
  }
  return {
    scene, camera, bloom: [1.0, 0.7, 0.55], exposure: 1.05,
    update(t, dur) {
      planet.rotation.y = t * 0.06; clouds.rotation.y = t * 0.075;
      for (const s of ships) {
        const age = t - s.ts;
        const show = age > 0; s.head.visible = s.line.visible = show; if (!show) continue;
        const r = R * 1.02 + 0.5 * s.acc * age * age + age * 0.6;
        const tail = Math.max(R * 1.02, r - 2.5 - age * 1.2);
        s.head.position.copy(s.dir).multiplyScalar(r);
        const a = s.line.geometry.attributes.position; a.setXYZ(0, s.dir.x * tail, s.dir.y * tail, s.dir.z * tail); a.setXYZ(1, s.head.position.x, s.head.position.y, s.head.position.z); a.needsUpdate = true;
      }
      const u = easeInOut(t / dur);
      camera.position.set(lerp(-3, -8, u), lerp(3, 6, u), lerp(38, 58, u));
      camera.lookAt(0, lerp(0, 3.5, u), 0);
    },
  };
}
