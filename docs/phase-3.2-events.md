# Phase 3.2 scene events

Storyboard version 2 scenes can give procedural props stable `id` values and timed actions in `events`. Existing scenes without IDs or events keep their current procedural composition and motion. The renderer derives stable IDs for otherwise-unreferenced legacy props.

```json
{
  "schema_version": 2,
  "actors": [{"id": "traveler", "name": "Traveler"}],
  "scenes": [{
    "id": "forest-encounter",
    "duration": 8,
    "visual": {"props": [
      {"id": "dinosaur", "kind": "dinosaur", "position": [0, 0, -5], "visible": false},
      {"id": "traveler-prop", "actor_id": "traveler", "kind": "human", "position": [0, 0, 2]}
    ]},
    "events": [
      {"id": "dinosaur-enters", "type": "enter", "actor_id": "dinosaur", "start": 0, "duration": 2, "from_position": [-8, 0, -5], "to_position": [0, 0, -5]},
      {"id": "traveler-runs", "type": "run", "actor_id": "traveler", "start": 2, "duration": 2, "from_position": [0, 0, 2], "to_position": [5, 0, 2], "easing": "ease_in_out"},
      {"id": "dinosaur-follows", "type": "follow", "actor_id": "dinosaur", "target_id": "traveler", "start": 4, "duration": 2, "parameters": {"offset": [0, 0, -2]}},
      {"id": "traveler-looks-back", "type": "look_at", "actor_id": "traveler", "target_id": "dinosaur", "start": 6, "duration": 0}
    ]
  }]
}
```

The example is a scene excerpt; normal version 2 story fields and total duration rules still apply. `actor_id` names the instance controlled by the action. `target_id` is used by `follow`, `move_toward`, `approach`, and `look_at`. A prop may use the same ID for both `id` and its actor reference, or give an `actor_id` alias. Actor definitions remain reusable metadata; the instance and its procedural `kind` are in `visual.props`.

Supported actions are `enter`, `exit`, `move`, `walk`, `run`, `turn`, `wait`, `follow`, `move_toward`, `approach`, `look_at`, `appear`, and `disappear`. Motion is root position/rotation only; no skeletal animation is implied. `turn` uses `to_rotation` or `parameters.rotation`; `follow` accepts a three-number `parameters.offset`; `move_toward` and `approach` accept a nonnegative `parameters.distance`. Other parameters are rejected.

Events use seconds from scene start. Intervals are active on `[start, start + duration)`. At the end timestamp a transform reaches its endpoint and remains there. If `from_position` or `from_rotation` is omitted, the instance's initial transform is used. Zero-duration events apply their final state at exactly `start` and remain in effect for later timestamps. `enter` is hidden before its start and visible from its start; `exit` becomes hidden at its end. Scene-end zero-duration events are evaluated when the scene is sampled at its duration.

Two events may overlap when they affect different instances or different properties. Overlapping events that both write the same instance property are rejected; intervals that only touch at an endpoint are allowed. Interaction dependency cycles, self-targets, unknown instance IDs, unknown actions, and events extending past the scene duration are rejected. Event order is stable by start time and ID, and nonconflicting actions are independent of JSON array order.

Every update is evaluated from initial transforms and the supplied absolute scene time. Seeking, reversed frame order, repeated timestamps, and parallel render chunks therefore use the same event state. The previous Phase 2 procedural prop motions and camera movements are also evaluated from absolute time. Environments retain their existing seeded procedural layouts.
