// Shared helpers for the "What If" low-poly 3D film.
// Everything is deterministic: motion is a pure function of time, randomness is seeded.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/* ---------- math ---------- */
export function rngFrom(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
export const easeInOut = (t) => { t = clamp(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
export const easeOut = (t) => 1 - Math.pow(1 - clamp(t), 3);
export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
export const range = (rng, a, b) => a + (b - a) * rng();
export const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
export const lerpV = (a, b, t) => new THREE.Vector3().lerpVectors(a, b, t);

/** Catmull-Rom style camera rig: keys = [{p:[x,y,z], l:[x,y,z]}], u in 0..1 */
export function cameraRig(camera, keys, ease = easeInOut) {
  const ps = new THREE.CatmullRomCurve3(keys.map((k) => new THREE.Vector3(...k.p)));
  const ls = new THREE.CatmullRomCurve3(keys.map((k) => new THREE.Vector3(...k.l)));
  if (keys.length === 1) return () => { camera.position.set(...keys[0].p); camera.lookAt(...keys[0].l); };
  return (u, shake = 0, t = 0) => {
    const e = ease(u);
    camera.position.copy(ps.getPoint(e));
    const look = ls.getPoint(e);
    if (shake) {
      camera.position.x += Math.sin(t * 1.3) * shake + Math.sin(t * 3.1) * shake * 0.3;
      camera.position.y += Math.sin(t * 1.7 + 1) * shake * 0.6;
    }
    camera.lookAt(look);
  };
}

/* ---------- materials & textures ---------- */
export function mat(color, o = {}) {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, metalness: 0, ...o });
}
export function glow(color, k = 1) {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k) });
}
export function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (draw) draw(g, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { canvas: c, ctx: g, tex, redraw(fn) { fn(g, w, h); tex.needsUpdate = true; } };
}
export function gradientTexture(stops, h = 512) {
  return canvasTexture(4, h, (g, w, hh) => {
    const gr = g.createLinearGradient(0, 0, 0, hh);
    stops.forEach(([o, c]) => gr.addColorStop(o, c));
    g.fillStyle = gr; g.fillRect(0, 0, w, hh);
  }).tex;
}
export function spriteTexture() {
  return canvasTexture(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.25, 'rgba(255,255,255,0.8)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  }).tex;
}

/** Facade texture: grid of windows, some lit. */
export function windowTexture(rng, o = {}) {
  const { cols = 8, rows = 16, lit = 0.45, wall = '#15171d', dark = '#06070a',
    colors = ['#ffd59a', '#ffc77a', '#fff0d2', '#ffe3b0', '#bcdcff'] } = o;
  const cw = 32, ch = 32;
  const t = canvasTexture(cols * cw, rows * ch, (g, w, h) => {
    g.fillStyle = wall; g.fillRect(0, 0, w, h);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const on = rng() < lit;
      g.fillStyle = on ? pick(rng, colors) : dark;
      g.globalAlpha = on ? 0.5 + 0.5 * rng() : 1;
      g.fillRect(c * cw + 7, r * ch + 6, cw - 14, ch - 12);
      g.globalAlpha = 1;
    }
  }).tex;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
/** Box building with a windowed facade. One cell of texture ~= 12m x 24m. */
export function building(w, h, d, tex, glowK = 1.2, tint = '#ffffff') {
  const mk = (rw, rh) => {
    const t = tex.clone(); t.needsUpdate = true; t.repeat.set(rw, rh);
    return new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: new THREE.Color(tint), emissiveIntensity: glowK, roughness: 0.9, flatShading: true });
  };
  const side = mk(d / 12, h / 24), front = mk(w / 12, h / 24), top = mat('#0d0e12');
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [side, side, top, top, front, front]);
  m.position.y = h / 2;
  return m;
}

/** A sign made of glowing text on a dark panel. */
export function neonSign(text, { color = '#ff4f8b', w = 1024, h = 256, font = '800 120px Inter', bg = 'rgba(10,8,14,0.92)', k = 2.2, border = true } = {}) {
  const t = canvasTexture(w, h, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    if (border) { g.strokeStyle = color; g.lineWidth = 10; g.shadowColor = color; g.shadowBlur = 30; g.strokeRect(14, 14, w - 28, h - 28); }
    g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = color; g.shadowBlur = 40; g.fillStyle = color;
    g.fillText(text, w / 2, h / 2 + 6);
    g.shadowBlur = 0; g.fillStyle = '#fff'; g.globalAlpha = 0.55; g.fillText(text, w / 2, h / 2 + 6);
  });
  const material = new THREE.MeshBasicMaterial({ map: t.tex, color: new THREE.Color(1, 1, 1).multiplyScalar(k) });
  return { mesh: new THREE.Mesh(new THREE.PlaneGeometry(w / h, 1), material), tex: t };
}

/* ---------- geometry builders ---------- */
function limb(a, b, r0, r1, seg = 5) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(v3(0, 1, 0), dir.normalize()));
  g.translate(a.x, a.y, a.z);
  return g;
}
/** Bare, gnarled tree as one merged mesh. */
export function bareTree(rng, { height = 7, depth = 5, color = '#17161b', radius = 0.35 } = {}) {
  const parts = [];
  const grow = (start, dir, len, rad, d) => {
    const end = start.clone().addScaledVector(dir, len);
    parts.push(limb(start, end, rad, rad * 0.7));
    if (d <= 0) return;
    const n = rng() < 0.35 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const nd = dir.clone().add(v3(range(rng, -0.9, 0.9), range(rng, -0.1, 0.5), range(rng, -0.9, 0.9))).normalize();
      grow(end, nd, len * range(rng, 0.62, 0.8), rad * 0.66, d - 1);
    }
  };
  grow(v3(0, 0, 0), v3(range(rng, -0.1, 0.1), 1, range(rng, -0.1, 0.1)).normalize(), height * 0.38, radius, depth);
  const geo = mergeGeometries(parts.map((p) => p.toNonIndexed()));
  return new THREE.Mesh(geo, mat(color));
}

export function starField(rng, n = 2500, r = 400, size = 1.4) {
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = rng() * 2 - 1, th = rng() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    pos.set([Math.cos(th) * s * r, Math.abs(u) * r * 0.95 + 5, Math.sin(th) * s * r], i * 3);
    const b = 0.4 + rng() * 0.9;
    col.set([b, b, b * (0.9 + rng() * 0.2)], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ size, sizeAttenuation: false, vertexColors: true, map: spriteTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
}

/** Drifting motes / snow / embers. Deterministic wrap-around motion. */
export function drift(rng, n, box, { color = '#ffffff', size = 0.08, fall = 0.3, sway = 0.3, opacity = 0.8, additive = true } = {}) {
  const base = new Float32Array(n * 3), pos = new Float32Array(n * 3), ph = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    base.set([range(rng, box[0], box[1]), range(rng, box[2], box[3]), range(rng, box[4], box[5])], i * 3);
    ph[i] = rng() * 100;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ color, size, map: spriteTexture(), transparent: true, opacity, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
  pts.frustumCulled = false;
  const H = box[3] - box[2];
  pts.userData.update = (t) => {
    for (let i = 0; i < n; i++) {
      const p = ph[i];
      let y = base[i * 3 + 1] - fall * (t + p * 0.37);
      y = box[2] + ((((y - box[2]) % H) + H) % H);
      pos[i * 3] = base[i * 3] + Math.sin(t * 0.7 + p) * sway;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = base[i * 3 + 2] + Math.cos(t * 0.5 + p) * sway;
    }
    g.attributes.position.needsUpdate = true;
  };
  return pts;
}

/* ---------- low-poly people (instanced) ---------- */
const PERSON_GEO = {
  legs: new THREE.BoxGeometry(0.3, 0.76, 0.2).translate(0, 0.38, 0),
  torso: new THREE.CylinderGeometry(0.25, 0.19, 0.72, 7).translate(0, 0.36, 0),
  head: new THREE.IcosahedronGeometry(0.165, 1),
  arm: new THREE.BoxGeometry(0.09, 0.6, 0.09).translate(0, -0.3, 0),
  cone: new THREE.ConeGeometry(0.11, 0.3, 6).translate(0, 0.1, 0),
  beanie: new THREE.SphereGeometry(0.175, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.01, 0),
  brim: mergeGeometries([new THREE.CylinderGeometry(0.15, 0.15, 0.2, 8).translate(0, 0.14, 0), new THREE.CylinderGeometry(0.27, 0.27, 0.025, 10).translate(0, 0.04, 0)].map((g) => g.toNonIndexed())),
  hood: new THREE.SphereGeometry(0.2, 7, 5, 0, Math.PI * 2, 0, Math.PI * 0.62).translate(0, -0.02, -0.02),
  phone: new THREE.BoxGeometry(0.08, 0.13, 0.03),
  cane: new THREE.CylinderGeometry(0.018, 0.018, 0.9, 4).translate(0, -0.45, 0),
};
const _TOR = new THREE.Matrix4(), _P = new THREE.Matrix4(), _T = new THREE.Matrix4(), _A = new THREE.Matrix4(), _H = new THREE.Matrix4(), _M = new THREE.Matrix4(), _AR = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const LIE = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
function rot(m, x, y, z) { return m.makeRotationFromEuler(_e.set(x, y, z)); }

/**
 * people: [{x,y,z,ry,s, body,legs,skin, hat:'cone'|'beanie'|'brim'|'hood'|null, hatColor, phone, cane, pose, phase}]
 * pose(person, t) -> {bob, lean, head, aL, aR, fL, fR, sit, lie, dx, dz}
 */
export class Crowd {
  constructor(people, { phoneGlow = 3, roughness = 0.9 } = {}) {
    this.people = people;
    this.group = new THREE.Group();
    const n = people.length;
    const mk = (geo, material) => {
      const m = new THREE.InstancedMesh(geo, material, n);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      this.group.add(m);
      return m;
    };
    const white = () => mat('#ffffff', { roughness });
    this.legs = mk(PERSON_GEO.legs, white());
    this.torso = mk(PERSON_GEO.torso, white());
    this.armL = mk(PERSON_GEO.arm, white());
    this.armR = mk(PERSON_GEO.arm, white());
    this.head = mk(PERSON_GEO.head, white());
    this.hats = {};
    for (const h of ['cone', 'beanie', 'brim', 'hood']) if (people.some((p) => p.hat === h)) this.hats[h] = mk(PERSON_GEO[h], white());
    if (people.some((p) => p.phone)) this.phone = mk(PERSON_GEO.phone, new THREE.MeshBasicMaterial({ color: new THREE.Color('#dfeaff').multiplyScalar(phoneGlow) }));
    if (people.some((p) => p.cane)) this.cane = mk(PERSON_GEO.cane, mat('#3b2a1e'));
    const c = new THREE.Color();
    people.forEach((p, i) => {
      this.legs.setColorAt(i, c.set(p.legs || '#222'));
      this.torso.setColorAt(i, c.set(p.body || '#444'));
      this.armL.setColorAt(i, c.set(p.body || '#444'));
      this.armR.setColorAt(i, c.set(p.body || '#444'));
      this.head.setColorAt(i, c.set(p.skin || '#c99a7a'));
      for (const h in this.hats) this.hats[h].setColorAt(i, c.set(p.hatColor || '#333'));
    });
  }
  update(t) {
    const P = _P;
    this.people.forEach((p, i) => {
      const o = p.pose ? p.pose(p, t) : {};
      const s = (p.s || 1);
      _p.set(p.x + (o.dx || 0), (p.y || 0) + (o.bob || 0), p.z + (o.dz || 0));
      _q.setFromEuler(_e.set(0, (p.ry || 0) + (o.turn || 0), 0));
      P.compose(_p, _q, _s.set(s, s, s));
      if (o.lie) P.multiply(LIE);
      // legs
      if (o.sit) { _M.copy(P).multiply(_T.makeTranslation(0, 0.72, 0)).multiply(rot(_A, 2.05, 0, 0)); this.legs.setMatrixAt(i, _M); }
      else this.legs.setMatrixAt(i, P);
      // torso
      const tor = _TOR.copy(P).multiply(_T.makeTranslation(0, 0.72, 0)).multiply(rot(_A, o.lean || 0, 0, o.tilt || 0));
      this.torso.setMatrixAt(i, tor);
      // head
      _H.copy(tor).multiply(_T.makeTranslation(0, 0.9, 0.0)).multiply(rot(_A, o.head || 0, o.headY || 0, 0));
      this.head.setMatrixAt(i, _H);
      for (const h in this.hats) this.hats[h].setMatrixAt(i, p.hat === h ? _M.copy(_H).multiply(_T.makeTranslation(0, 0.11, 0)) : ZERO);
      // arms: aL/aR = sideways raise (rad), fL/fR = forward raise (rad)
      _M.copy(tor).multiply(_T.makeTranslation(-0.3, 0.64, 0)).multiply(rot(_A, -(o.fL || 0), 0, -(o.aL || 0.08)));
      this.armL.setMatrixAt(i, _M);
      _AR.copy(tor).multiply(_T.makeTranslation(0.3, 0.64, 0)).multiply(rot(_A, -(o.fR || 0), 0, (o.aR || 0.08)));
      this.armR.setMatrixAt(i, _AR);
      if (this.phone) this.phone.setMatrixAt(i, p.phone ? _M.copy(_AR).multiply(_T.makeTranslation(0, -0.64, 0.02)) : ZERO);
      if (this.cane) this.cane.setMatrixAt(i, p.cane ? _M.copy(_AR).multiply(_T.makeTranslation(0, -0.58, 0)).multiply(rot(_A, (o.fR || 0), 0, -(o.aR || 0.08))) : ZERO);
    });
    for (const m of this.group.children) m.instanceMatrix.needsUpdate = true;
  }
}

/** Fill a rectangle with people on a jittered grid. */
export function crowdGrid(rng, { x0, x1, z0, z1, gap = 0.8, skip = () => false, make }) {
  const out = [];
  for (let z = z0; z <= z1; z += gap) for (let x = x0; x <= x1; x += gap) {
    const px = x + range(rng, -0.28, 0.28) * gap, pz = z + range(rng, -0.28, 0.28) * gap;
    if (skip(px, pz)) continue;
    out.push(make(px, pz));
  }
  return out;
}

export const SKIN = ['#f1c7a5', '#e0ac85', '#c98e66', '#a86f4c', '#7d4f33', '#5a3622', '#f3d2b8'];
export const COATS = ['#1f2a44', '#3b1f2b', '#2c2c2c', '#5a2a22', '#20403b', '#6b4f2a', '#40355a', '#8a2f2f', '#1d1d25', '#4b5563', '#b4552f', '#2f5d8a', '#c7a14a', '#efe7da'];
