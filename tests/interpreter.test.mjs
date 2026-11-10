import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../engine/what-if/vendor/three/three.module.min.js';
import { buildDynamicScene } from '../engine/what-if/src/interpreter.js';

const environments = ['plain', 'prehistoric_jungle', 'underwater_city', 'ocean', 'desert', 'forest', 'city', 'space'];
const propKinds = ['dinosaur', 'human', 'tree', 'coral', 'rock', 'building', 'submarine', 'fish', 'bubble', 'vehicle', 'crystal'];

test('constructs every supported environment with background, fog, ground and lights', () => {
  for (const environment of environments) {
    const shot = buildDynamicScene({ visual: { environment, background: '#112233', ground: '#223344', fog_color: '#334455', fog_density: 0.04, light_color: '#ffffff', light_intensity: 2, props: [] } });
    assert.ok(shot.scene.background.isColor, environment);
    assert.ok(shot.scene.fog instanceof THREE.FogExp2, environment);
    assert.ok(shot.scene.children.some((o) => o.isHemisphereLight), environment);
    assert.ok(shot.scene.children.some((o) => o.isDirectionalLight), environment);
    assert.ok(shot.scene.children.some((o) => o.isMesh && o.geometry.type === 'PlaneGeometry'), environment);
    assert.equal(shot.scene.fog.density, 0.04, environment);
  }
});

test('underwater city combines habitat towers with reef geometry', () => {
  const shot = buildDynamicScene({ visual: { environment: 'underwater_city', props: [] } });
  const meshes = [];
  shot.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
  assert.ok(meshes.some((o) => o.geometry.type === 'BoxGeometry'));
  assert.ok(meshes.filter((o) => o.geometry.type === 'ConeGeometry').length >= 34);
  assert.ok(meshes.filter((o) => o.geometry.type === 'SphereGeometry').length >= 70);
});

test('constructs all supported procedural props and applies transforms', () => {
  for (const kind of propKinds) {
    const shot = buildDynamicScene({ visual: { environment: 'plain', props: [{ kind, color: '#aabbcc', position: [2, 3, -4], rotation: [0, 0.5, 0], scale: [2, 3, 4], motion: 'still' }] } });
    const prop = shot.scene.children.find((o) => o.isGroup);
    assert.ok(prop, kind);
    assert.ok(prop.children.length > 0, kind);
    assert.deepEqual(prop.position.toArray(), [2, 3, -4], kind);
    assert.deepEqual(prop.scale.toArray(), [2, 3, 4], kind);
    assert.ok(Math.abs(prop.rotation.y - 0.5) < 1e-8, kind);
  }
});

test('camera and light instructions reach Three.js objects', () => {
  const shot = buildDynamicScene({ visual: { environment: 'plain', camera_position: [4, 5, 16], camera_look_at: [1, 2, -3], light_color: '#ff8844', light_intensity: 3, props: [] } });
  assert.deepEqual(shot.camera.position.toArray(), [4, 5, 16]);
  assert.equal(shot.camera.fov, 45);
  const expectedDirection = new THREE.Vector3(1, 2, -3).sub(new THREE.Vector3(4, 5, 16)).normalize();
  assert.ok(shot.camera.getWorldDirection(new THREE.Vector3()).distanceTo(expectedDirection) < 1e-8);
  const key = shot.scene.children.find((o) => o.isDirectionalLight);
  assert.equal(key.intensity, 3);
  assert.equal(key.color.getHexString(), 'ff8844');
  assert.equal(shot.scene.fog.color.getHexString(), '101827');
});

test('camera movements and supported prop motions are deterministic', () => {
  for (const movement of ['push', 'pan', 'orbit']) {
    const shot = buildDynamicScene({ visual: { environment: 'plain', camera_position: [0, 2, 12], camera_look_at: [0, 1, 0], camera_movement: movement, props: [] } });
    shot.update(2, 4);
    assert.notDeepEqual(shot.camera.position.toArray(), [0, 2, 12], movement);
  }
  for (const motion of ['walk', 'swim', 'fly', 'bob', 'spin']) {
    const shot = buildDynamicScene({ visual: { environment: 'plain', props: [{ kind: 'fish', position: [0, 1, -5], motion }] } });
    const prop = shot.scene.children.find((o) => o.isGroup);
    shot.update(0.7, 2);
    if (motion === 'spin') assert.notEqual(prop.rotation.y, 0, motion);
    else assert.notDeepEqual(prop.position.toArray(), [0, 1, -5], motion);
  }
});

test('dynamic scene events drive identified instances and remain stable when seeking out of order', () => {
  const shot = buildDynamicScene({
    id: 'forest', duration: 6,
    events: [
      { id: 'dino-entry', type: 'enter', actor_id: 'dino', start: 0, duration: 2, from_position: [-8, 0, -5], to_position: [0, 0, -5] },
      { id: 'human-run', type: 'run', actor_id: 'human', start: 2, duration: 2, from_position: [0, 0, 1], to_position: [5, 0, 1] },
      { id: 'look', type: 'look_at', actor_id: 'human', target_id: 'dino', start: 4, duration: 0 },
    ],
    visual: { environment: 'plain', props: [
      { id: 'dino', kind: 'dinosaur', position: [0, 0, -5], visible: false },
      { id: 'human', kind: 'human', position: [0, 0, 1] },
    ] },
  });
  const dino = shot.scene.children.find((o) => o.userData.instanceId === 'dino');
  const human = shot.scene.children.find((o) => o.userData.instanceId === 'human');
  shot.update(1, 6); const entry = dino.position.toArray();
  shot.update(5, 6); const finalHuman = human.position.toArray();
  shot.update(0, 6); assert.deepEqual(dino.position.toArray(), [-8, 0, -5]);
  shot.update(1, 6); assert.deepEqual(dino.position.toArray(), entry);
  shot.update(5, 6); assert.deepEqual(human.position.toArray(), finalHuman);
  assert.equal(dino.visible, true);
  assert.equal(human.userData.motion, 'still');
});

test('story actor IDs alias explicit prop IDs and events update only the targeted procedural instance', () => {
  const shot = buildDynamicScene({ duration: 3, events: [{ id: 'move', type: 'move', actor_id: 'traveler', start: 0, duration: 2, to_position: [2, 0, 0] }], visual: { props: [
    { id: 'traveler-prop', actor_id: 'traveler', kind: 'human', position: [0, 0, 0] },
    { id: 'tree-prop', kind: 'tree', position: [5, 0, 0] },
  ] } });
  const traveler = shot.scene.children.find((o) => o.userData.actorId === 'traveler');
  const tree = shot.scene.children.find((o) => o.userData.instanceId === 'tree-prop');
  shot.update(1, 3);
  assert.deepEqual(traveler.position.toArray(), [1, 0, 0]);
  assert.deepEqual(tree.position.toArray(), [5, 0, 0]);
});
