import test from 'node:test';
import assert from 'node:assert/strict';
import { compileEventTimeline } from '../engine/what-if/src/event_timeline.js';

const actor = (id, position = [0, 0, 0], extra = {}) => ({ id, position, rotation: [0, 0, 0], scale: [1, 1, 1], ...extra });
const state = (timeline, id, time) => timeline.evaluate(time).get(id);
const pos = (timeline, id, time) => state(timeline, id, time).position;
const near = (actual, expected, epsilon = 1e-9) => actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < epsilon, `${actual} != ${expected}`));

test('event boundaries are deterministic before, at start, during, at end and after completion', () => {
  const timeline = compileEventTimeline([actor('dino')], [{ id: 'cross', type: 'move', actor_id: 'dino', start: 2, duration: 2, to_position: [4, 0, 0] }], 5);
  near(pos(timeline, 'dino', 1.99), [0, 0, 0]);
  near(pos(timeline, 'dino', 2), [0, 0, 0]);
  near(pos(timeline, 'dino', 3), [2, 0, 0]);
  near(pos(timeline, 'dino', 4), [4, 0, 0]);
  near(pos(timeline, 'dino', 5), [4, 0, 0]);
  assert.throws(() => timeline.evaluate(5.01), /within scene boundaries/);
});

test('events on separate actors overlap and event ordering does not affect the result', () => {
  const actors = [actor('a'), actor('b')];
  const events = [
    { id: 'a-move', type: 'move', actor_id: 'a', start: 0, duration: 2, to_position: [2, 0, 0] },
    { id: 'b-move', type: 'move', actor_id: 'b', start: 0, duration: 2, to_position: [0, 0, 4] },
  ];
  const left = compileEventTimeline(actors, events, 3), right = compileEventTimeline(actors, [...events].reverse(), 3);
  assert.deepEqual([...left.evaluate(1)], [...right.evaluate(1)]);
});

test('conflicting same-property events reject overlaps and allow touching boundaries', () => {
  const conflicting = [
    { id: 'one', type: 'move', actor_id: 'a', start: 0, duration: 2, to_position: [1, 0, 0] },
    { id: 'two', type: 'walk', actor_id: 'a', start: 1, duration: 2, to_position: [2, 0, 0] },
  ];
  assert.throws(() => compileEventTimeline([actor('a')], conflicting, 4), /conflict on position/);
  assert.doesNotThrow(() => compileEventTimeline([actor('a')], [
    { ...conflicting[0], id: 'one', type: 'move', start: 0, duration: 2 },
    { ...conflicting[1], id: 'two', type: 'move', start: 2, duration: 1 },
  ], 4));
});

test('invalid actions, instances, vectors, interactions and times report clear errors', () => {
  const invalid = [
    [{ id: 'x', type: 'dance', actor_id: 'a', start: 0, duration: 1 }],
    [{ id: 'x', type: 'move', actor_id: 'missing', start: 0, duration: 1, to_position: [1, 0, 0] }],
    [{ id: 'x', type: 'move', actor_id: 'a', start: 0, duration: 1, to_position: [1, 2] }],
    [{ id: 'x', type: 'follow', actor_id: 'a', start: 0, duration: 1 }],
    [{ id: 'x', type: 'move', actor_id: 'a', start: -1, duration: 1, to_position: [1, 0, 0] }],
    [{ id: 'x', type: 'move', actor_id: 'a', start: 0, duration: 2, to_position: [1, 0, 0] }],
    [{ id: 'x', type: 'wait', actor_id: 'a', start: 0, duration: 0, easing: 'bounce' }],
  ];
  for (const events of invalid) assert.throws(() => compileEventTimeline([actor('a')], events, 1));
  assert.throws(() => compileEventTimeline([actor('a'), actor('a')], [], 1), /Duplicate instance/);
  assert.throws(() => compileEventTimeline([actor('a'), actor('b')], [
    { id: 'duplicate', type: 'wait', actor_id: 'a', start: 0, duration: 0 },
    { id: 'duplicate', type: 'wait', actor_id: 'b', start: 0, duration: 0 },
  ], 1), /Duplicate event id/);
});

test('zero duration events apply at their timestamp and scene boundary', () => {
  const timeline = compileEventTimeline([actor('a')], [{ id: 'jump', type: 'move', actor_id: 'a', start: 4, duration: 0, to_position: [9, 0, 0] }], 4);
  near(pos(timeline, 'a', 3.99), [0, 0, 0]);
  near(pos(timeline, 'a', 4), [9, 0, 0]);
});

test('initial transforms and visibility are retained; enter, exit and visibility actions execute', () => {
  const timeline = compileEventTimeline([actor('a', [1, 2, 3], { rotation: [0, 0.2, 0], scale: [2, 2, 2], visible: false }), actor('ghost', [0, 0, 0], { visible: false })], [
    { id: 'arrival', type: 'enter', actor_id: 'a', start: 1, duration: 1, from_position: [-2, 0, 0], to_position: [2, 0, 0] },
    { id: 'leave', type: 'exit', actor_id: 'a', start: 3, duration: 1, from_position: [2, 0, 0], to_position: [4, 0, 0] },
    { id: 'reveal', type: 'appear', actor_id: 'ghost', start: 0.5, duration: 0 },
    { id: 'hide', type: 'disappear', actor_id: 'ghost', start: 2, duration: 0 },
  ], 5);
  assert.equal(state(timeline, 'a', 0).visible, false);
  assert.equal(state(timeline, 'a', 1).visible, true);
  near(pos(timeline, 'a', 1.5), [0, 0, 0]);
  assert.equal(state(timeline, 'a', 2).visible, true);
  near(state(timeline, 'a', 0).rotation, [0, 0.2, 0]);
  near(state(timeline, 'a', 0).scale, [2, 2, 2]);
  assert.equal(state(timeline, 'a', 4).visible, false);
  assert.equal(state(timeline, 'ghost', 0.49).visible, false);
  assert.equal(state(timeline, 'ghost', 0.5).visible, true);
  assert.equal(state(timeline, 'ghost', 2).visible, false);
});

test('move, turn, walk and run use absolute interpolation and expose root motion states', () => {
  const timeline = compileEventTimeline([actor('a')], [
    { id: 'walk', type: 'walk', actor_id: 'a', start: 0, duration: 1, to_position: [2, 0, 0] },
    { id: 'turn', type: 'turn', actor_id: 'a', start: 1, duration: 1, to_rotation: [0, Math.PI, 0] },
    { id: 'run', type: 'run', actor_id: 'a', start: 2, duration: 1, from_position: [2, 0, 0], to_position: [5, 0, 0], easing: 'ease_in' },
  ], 4);
  near(pos(timeline, 'a', 0.5), [1, 0, 0]);
  assert.equal(state(timeline, 'a', 0.5).motion, 'walk');
  near(state(timeline, 'a', 1.5).rotation, [0, Math.PI / 2, 0]);
  near(pos(timeline, 'a', 2.5), [2.75, 0, 0]);
  assert.equal(state(timeline, 'a', 2.5).motion, 'run');
  assert.equal(state(timeline, 'a', 3).motion, 'still');
  const toward = compileEventTimeline([actor('a'), actor('target', [0, 0, 4])], [
    { id: 'approach', type: 'move_toward', actor_id: 'a', target_id: 'target', start: 0, duration: 2 },
  ], 3);
  near(pos(toward, 'a', 2), [0, 0, 4]);
});

test('follow, approach and look_at resolve target state at absolute timestamps', () => {
  const timeline = compileEventTimeline([actor('runner'), actor('dino', [0, 0, 10])], [
    { id: 'dino-moves', type: 'move', actor_id: 'dino', start: 0, duration: 4, to_position: [4, 0, 10] },
    { id: 'follow', type: 'follow', actor_id: 'runner', target_id: 'dino', start: 0, duration: 4, parameters: { offset: [-2, 0, 0] } },
  ], 5);
  near(pos(timeline, 'runner', 2), [0, 0, 10]);
  const approach = compileEventTimeline([actor('a'), actor('b', [0, 0, 10])], [
    { id: 'move-target', type: 'move', actor_id: 'b', start: 0, duration: 4, to_position: [4, 0, 10] },
    { id: 'approach', type: 'approach', actor_id: 'a', target_id: 'b', start: 0, duration: 4, parameters: { distance: 2 } },
    { id: 'look', type: 'look_at', actor_id: 'a', target_id: 'b', start: 4, duration: 0 },
  ], 5);
  const expectedApproach = [4 - 8 / Math.sqrt(116), 0, 10 - 20 / Math.sqrt(116)];
  near(pos(approach, 'a', 4), expectedApproach);
  assert.ok(Math.abs(state(approach, 'a', 4).rotation[1] - Math.atan2(4, 10)) < 1e-9);
});

test('same timestamp output is stable in repeated, reverse and shuffled evaluation order', () => {
  const instances = [actor('a'), actor('b', [0, 0, 5]), actor('c', [5, 0, 0])];
  const events = [
    { id: 'a-move', type: 'move', actor_id: 'a', start: 0, duration: 4, to_position: [4, 0, 0] },
    { id: 'b-move', type: 'move', actor_id: 'b', start: 1, duration: 3, to_position: [0, 0, 1] },
    { id: 'c-turn', type: 'turn', actor_id: 'c', start: 0, duration: 4, to_rotation: [0, 1, 0] },
  ];
  const timeline = compileEventTimeline(instances, events, 5);
  const expected = JSON.stringify([...timeline.evaluate(2)]);
  assert.equal(JSON.stringify([...timeline.evaluate(2)]), expected);
  for (const t of [4, 0, 3, 1, 2, 0.5, 3.5]) timeline.evaluate(t);
  assert.equal(JSON.stringify([...timeline.evaluate(2)]), expected);
  let seed = 918273;
  const randomTimes = Array.from({ length: 25 }, () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 5; });
  const reference = compileEventTimeline(instances, events, 5);
  for (const t of randomTimes) {
    timeline.evaluate(t);
    assert.deepEqual([...timeline.evaluate(t)], [...reference.evaluate(t)]);
  }
  const chunkA = compileEventTimeline(instances, events, 5), chunkB = compileEventTimeline(instances, events, 5);
  const frameTimes = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 2, 2.5];
  const chunkSnapshots = [...frameTimes.slice(0, 6).map((t) => [t, [...chunkA.evaluate(t)]]), ...frameTimes.slice(6).map((t) => [t, [...chunkB.evaluate(t)]])];
  for (const [t, snapshot] of chunkSnapshots) assert.deepEqual(snapshot, [...reference.evaluate(t)], `chunk boundary at ${t}`);
});

test('interaction cycles and self-targets are rejected', () => {
  assert.throws(() => compileEventTimeline([actor('a'), actor('b')], [
    { id: 'a-follows-b', type: 'follow', actor_id: 'a', target_id: 'b', start: 0, duration: 1 },
    { id: 'b-follows-a', type: 'follow', actor_id: 'b', target_id: 'a', start: 0, duration: 1 },
  ], 2), /cycle/);
  assert.throws(() => compileEventTimeline([actor('a')], [{ id: 'self', type: 'follow', actor_id: 'a', target_id: 'a', start: 0, duration: 1 }], 2), /itself/);
});
