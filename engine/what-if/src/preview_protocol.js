export function validatePreviewSeekMessage(event, { origin, source, timeline, previewId }) {
  if (!event || event.origin !== origin || event.source !== source) return null;
  const data = event.data;
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.type !== 'scene-preview:seek'
      || typeof previewId !== 'string' || data.preview_id !== previewId) return null;
  if (typeof data.scene_id !== 'string' || typeof data.local_time !== 'number' || !Number.isFinite(data.local_time)) return null;
  const scene = timeline.find((item) => item.id === data.scene_id);
  if (!scene || !Number.isFinite(scene.dur) || data.local_time < 0 || data.local_time >= scene.dur) return null;
  return { scene, local_time: data.local_time };
}
