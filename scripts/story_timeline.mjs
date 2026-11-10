export function storyboardDuration(story) {
  if (!story || !Array.isArray(story.scenes) || story.scenes.length === 0) return null;
  const durations = story.scenes.map((scene) => Number(scene.duration));
  if (durations.some((duration) => !Number.isFinite(duration) || duration <= 0)) {
    throw new Error('Storyboard scene durations must be finite positive numbers.');
  }
  return durations.reduce((sum, duration) => sum + duration, 0);
}

export function sampleTimelineDuration(source) {
  const match = source.match(/export\s+(?:const|let)\s+TIMELINE\s*=\s*\[([\s\S]*?)\n\];/);
  if (!match) throw new Error('Could not locate the bundled sample timeline.');
  const durations = [...match[1].matchAll(/\bdur:\s*([\d.]+)/g)].map((entry) => Number(entry[1]));
  if (!durations.length || durations.some((duration) => !Number.isFinite(duration) || duration <= 0)) {
    throw new Error('Could not read valid scene durations from the bundled sample timeline.');
  }
  return durations.reduce((sum, duration) => sum + duration, 0);
}

export function renderDuration(source, story) {
  return storyboardDuration(story) ?? sampleTimelineDuration(source);
}

export function frameRanges(totalDuration, fps, chunkCount) {
  if (!Number.isFinite(totalDuration) || totalDuration <= 0 || !Number.isInteger(fps) || fps <= 0 || !Number.isInteger(chunkCount) || chunkCount <= 0) {
    throw new Error('Duration, frame rate, and chunk count must be positive numbers.');
  }
  const frames = Math.round(totalDuration * fps);
  return Array.from({ length: chunkCount }, (_, i) => [Math.round((frames * i) / chunkCount), Math.round((frames * (i + 1)) / chunkCount)]);
}
