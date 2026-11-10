const ACTIONS = new Set(['enter', 'exit', 'move', 'walk', 'run', 'turn', 'wait', 'follow', 'move_toward', 'approach', 'look_at', 'appear', 'disappear']);
const INTERACTIONS = new Set(['follow', 'move_toward', 'approach', 'look_at']);
const POSITION_ACTIONS = new Set(['enter', 'exit', 'move', 'walk', 'run', 'follow', 'move_toward', 'approach']);
const VISIBILITY_ACTIONS = new Set(['enter', 'exit', 'appear', 'disappear']);

const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const vector = (v, label) => {
  if (!Array.isArray(v) || v.length !== 3 || v.some((n) => !finite(n))) throw new Error(`${label} must be a finite three-number vector.`);
  return v;
};
const ease = (name, t) => {
  if (name === 'linear') return t;
  if (name === 'ease_in') return t * t;
  if (name === 'ease_out') return 1 - (1 - t) ** 2;
  if (name === 'ease_in_out') return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
  throw new Error(`Unsupported easing '${name}'.`);
};
const mix = (a, b, p) => [a[0] + (b[0] - a[0]) * p, a[1] + (b[1] - a[1]) * p, a[2] + (b[2] - a[2]) * p];
const compareEvents = (a, b) => a.start - b.start || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function properties(event) {
  const result = [];
  if (POSITION_ACTIONS.has(event.type)) result.push('position');
  if (event.type === 'turn' || event.type === 'look_at') result.push('rotation');
  if (VISIBILITY_ACTIONS.has(event.type)) result.push('visible');
  if (event.type === 'walk' || event.type === 'run') result.push('motion');
  return result;
}

function overlaps(a, b) {
  const aEnd = a.start + a.duration, bEnd = b.start + b.duration;
  if (a.duration === 0 && b.duration === 0) return a.start === b.start;
  if (a.duration === 0) return a.start >= b.start && a.start < bEnd;
  if (b.duration === 0) return b.start >= a.start && b.start < aEnd;
  return Math.max(a.start, b.start) < Math.min(aEnd, bEnd);
}

/** Compile validated, absolute-time actor events once; evaluate() mutates a reusable state Map. */
export function compileEventTimeline(instances, events, sceneDuration) {
  if (!Array.isArray(instances) || !Array.isArray(events)) throw new Error('Instances and events must be arrays.');
  if (!finite(sceneDuration) || sceneDuration < 0) throw new Error('Scene duration must be finite and nonnegative.');
  const byId = new Map(), aliases = new Map();
  for (const instance of instances) {
    if (!instance || typeof instance.id !== 'string' || !instance.id) throw new Error('Every scene instance needs a nonempty unique id.');
    if (byId.has(instance.id)) throw new Error(`Duplicate instance id '${instance.id}'.`);
    const state = { id: instance.id, position: [...vector(instance.position ?? [0, 0, 0], `Instance '${instance.id}' position`)], rotation: [...vector(instance.rotation ?? [0, 0, 0], `Instance '${instance.id}' rotation`)], scale: [...vector(instance.scale ?? [1, 1, 1], `Instance '${instance.id}' scale`)], visible: instance.visible !== false, motion: instance.motion || 'still', baseX: (instance.position ?? [0, 0, 0])[0], baseY: (instance.position ?? [0, 0, 0])[1] };
    byId.set(instance.id, state);
    if (instance.actor_id && aliases.has(instance.actor_id) && aliases.get(instance.actor_id) !== instance.id) throw new Error(`Duplicate actor instance reference '${instance.actor_id}'.`);
    if (aliases.has(instance.id) && aliases.get(instance.id) !== instance.id) throw new Error(`Instance id '${instance.id}' conflicts with another actor reference.`);
    aliases.set(instance.id, instance.id);
    if (instance.actor_id) aliases.set(instance.actor_id, instance.id);
  }
  const resolveId = (id) => aliases.get(id);
  const grouped = new Map();
  const eventIds = new Set();
  const normalized = events.map((raw) => {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id) throw new Error('Every event needs a nonempty id.');
    if (eventIds.has(raw.id)) throw new Error(`Duplicate event id '${raw.id}'.`);
    eventIds.add(raw.id);
    if (!ACTIONS.has(raw.type)) throw new Error(`Unsupported event type '${raw.type}'.`);
    if (!finite(raw.start) || raw.start < 0 || !finite(raw.duration ?? 0) || (raw.duration ?? 0) < 0 || raw.start + (raw.duration ?? 0) > sceneDuration + 1e-9) throw new Error(`Event '${raw.id}' has invalid timing for this scene.`);
    const actor_id = resolveId(raw.actor_id || (raw.actor_ids?.length === 1 ? raw.actor_ids[0] : undefined));
    if (!actor_id) throw new Error(`Event '${raw.id}' references an unknown or missing actor instance.`);
    const target_id = raw.target_id ? resolveId(raw.target_id) : undefined;
    if (INTERACTIONS.has(raw.type) && !target_id) throw new Error(`Event '${raw.id}' (${raw.type}) requires a valid target_id.`);
    if (target_id === actor_id) throw new Error(`Event '${raw.id}' cannot target itself.`);
    if (raw.from_position != null) vector(raw.from_position, `Event '${raw.id}' from_position`);
    if (raw.to_position != null) vector(raw.to_position, `Event '${raw.id}' to_position`);
    if (raw.from_rotation != null) vector(raw.from_rotation, `Event '${raw.id}' from_rotation`);
    if (raw.to_rotation != null) vector(raw.to_rotation, `Event '${raw.id}' to_rotation`);
    if (raw.parameters != null && (typeof raw.parameters !== 'object' || Array.isArray(raw.parameters))) throw new Error(`Event '${raw.id}' parameters must be an object.`);
    const e = { ...raw, actor_id, target_id, duration: raw.duration ?? 0, easing: raw.easing || 'linear', parameters: raw.parameters || {} };
    ease(e.easing, 0);
    const allowedParameters = e.type === 'follow' ? ['offset'] : ['move_toward', 'approach'].includes(e.type) ? ['distance'] : e.type === 'turn' ? ['rotation'] : [];
    for (const key of Object.keys(e.parameters)) if (!allowedParameters.includes(key)) throw new Error(`Event '${e.id}' has unsupported parameter '${key}' for action '${e.type}'.`);
    if (e.parameters.offset != null) vector(e.parameters.offset, `Event '${e.id}' parameters.offset`);
    if (e.parameters.rotation != null) vector(e.parameters.rotation, `Event '${e.id}' parameters.rotation`);
    if (e.parameters.distance != null && (!finite(e.parameters.distance) || e.parameters.distance < 0)) throw new Error(`Event '${e.id}' parameters.distance must be finite and nonnegative.`);
    if (['move', 'walk', 'run'].includes(e.type) && !e.to_position) throw new Error(`Event '${e.id}' (${e.type}) requires to_position.`);
    if (e.type === 'turn' && !e.to_rotation && !e.parameters.rotation) throw new Error(`Event '${e.id}' (turn) requires to_rotation or parameters.rotation.`);
    const list = grouped.get(actor_id) || [];
    list.push(e); grouped.set(actor_id, list);
    return e;
  });
  normalized.sort(compareEvents);
  for (const [actorId, list] of grouped) {
    list.sort(compareEvents);
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      if (list[j].start > list[i].start + list[i].duration && list[i].duration > 0) break;
      const shared = properties(list[i]).filter((p) => properties(list[j]).includes(p));
      if (shared.length && overlaps(list[i], list[j])) throw new Error(`Events '${list[i].id}' and '${list[j].id}' conflict on ${shared.join(', ')} for instance '${actorId}'.`);
    }
  }
  // Interaction dependencies must be acyclic so actor evaluation is independent of event order.
  const deps = new Map();
  for (const e of normalized) if (INTERACTIONS.has(e.type)) { const set = deps.get(e.actor_id) || new Set(); set.add(e.target_id); deps.set(e.actor_id, set); }
  const visiting = new Set(), visited = new Set();
  function visit(id) {
    if (visiting.has(id)) throw new Error(`Interaction cycle detected at instance '${id}'.`);
    if (visited.has(id)) return;
    visiting.add(id); for (const dep of deps.get(id) || []) visit(dep); visiting.delete(id); visited.add(id);
  }
  for (const id of byId.keys()) visit(id);

  function interpolate(event, a, b, t) {
    if (event.duration === 0) return [...b];
    const p = ease(event.easing, Math.max(0, Math.min(1, (t - event.start) / event.duration)));
    return mix(a, b, p);
  }
  function evaluateActor(id, t, cache, active) {
    const key = `${id}@${t}`;
    if (cache.has(key)) return cache.get(key);
    if (active.has(key)) throw new Error(`Interaction cycle detected at instance '${id}'.`);
    active.add(key);
    const initial = byId.get(id);
    const state = { id, position: [...initial.position], rotation: [...initial.rotation], scale: [...initial.scale], visible: initial.visible, motion: initial.motion };
    cache.set(key, state);
    const base = initial.position;
    // Preserve Phase 2 procedural prop motion, evaluated directly from absolute scene time.
    if (['bob', 'swim', 'fly'].includes(initial.motion)) state.position[1] += Math.sin(t * 2 + initial.baseX) * 0.22;
    if (initial.motion === 'walk' || initial.motion === 'fly') state.position[0] += Math.sin(t * 1.3 + initial.baseY) * 0.22;
    if (initial.motion === 'spin') state.rotation[1] = t * 0.5;
    for (const e of grouped.get(id) || []) {
      const end = e.start + e.duration;
      if (t < e.start) {
        if (e.type === 'enter') { state.visible = false; if (e.from_position) state.position = [...e.from_position]; }
        continue;
      }
      const activeEvent = e.duration > 0 && t < end;
      const at = activeEvent ? t : end;
      if (e.type === 'wait') continue;
      if (e.type === 'appear') { state.visible = true; continue; }
      if (e.type === 'disappear') { state.visible = false; continue; }
      if (e.type === 'enter' || e.type === 'exit') {
        const from = e.from_position || base, to = e.to_position || base;
        state.position = interpolate(e, from, to, at);
        state.visible = e.type === 'enter' || activeEvent;
        continue;
      }
      if (e.type === 'move' || e.type === 'walk' || e.type === 'run') {
        state.position = interpolate(e, e.from_position || base, e.to_position, at);
        if (e.type === 'walk' || e.type === 'run') state.motion = activeEvent ? e.type : 'still';
        continue;
      }
      if (e.type === 'turn') {
        state.rotation = interpolate(e, e.from_rotation || initial.rotation, e.to_rotation || e.parameters.rotation, at);
        continue;
      }
      const target = evaluateActor(e.target_id, at, cache, active);
      if (e.type === 'look_at') {
        const dx = target.position[0] - state.position[0], dz = target.position[2] - state.position[2];
        const from = e.from_rotation || initial.rotation, to = [...from];
        const desired = Math.atan2(dx, dz), delta = Math.atan2(Math.sin(desired - from[1]), Math.cos(desired - from[1]));
        to[1] = from[1] + delta;
        state.rotation = interpolate(e, from, to, at);
      } else if (e.type === 'follow') {
        const offset = e.parameters.offset || [0, 0, 0];
        state.position = [target.position[0] + offset[0], target.position[1] + offset[1], target.position[2] + offset[2]];
      } else {
        const targetAtEnd = evaluateActor(e.target_id, end, cache, active);
        const from = e.from_position || base;
        const distance = Number(e.parameters.distance || 0), dx = targetAtEnd.position[0] - from[0], dy = targetAtEnd.position[1] - from[1], dz = targetAtEnd.position[2] - from[2];
        const length = Math.hypot(dx, dy, dz) || 1;
        const destination = e.to_position || [targetAtEnd.position[0] - dx / length * distance, targetAtEnd.position[1] - dy / length * distance, targetAtEnd.position[2] - dz / length * distance];
        state.position = interpolate(e, from, destination, at);
      }
    }
    active.delete(key); return state;
  }

  return {
    events: normalized,
    evaluate(time, output = new Map()) {
      if (!finite(time) || time < 0 || time > sceneDuration + 1e-9) throw new Error('Evaluation time must be within scene boundaries.');
      const cache = new Map(), at = Math.min(time, sceneDuration);
      output.clear();
      for (const id of byId.keys()) output.set(id, evaluateActor(id, at, cache, new Set()));
      return output;
    },
  };
}
