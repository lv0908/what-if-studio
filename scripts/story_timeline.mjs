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

export function sceneFrameRanges(story, fps = 30) {
  if (!Number.isInteger(fps) || fps <= 0 || !Array.isArray(story?.scenes) || !story.scenes.length) {
    throw new Error('A nonempty storyboard and positive integer FPS are required.');
  }
  const ranges = new Map();
  let elapsed = 0, startFrame = 0;
  for (const scene of story.scenes) {
    const duration = Number(scene?.duration);
    if (typeof scene?.id !== 'string' || !scene.id || ranges.has(scene.id)
        || !Number.isFinite(duration) || duration <= 0) {
      throw new Error('Scene IDs must be unique and scene durations finite and positive.');
    }
    elapsed += duration;
    const endFrame = Math.floor(elapsed * fps + 0.5);
    if (endFrame <= startFrame) throw new Error(`Scene '${scene.id}' is shorter than one frame at ${fps} FPS.`);
    ranges.set(scene.id, {
      start_frame: startFrame,
      end_frame: endFrame,
      scene_duration: duration,
      rendered_duration: (endFrame - startFrame) / fps,
    });
    startFrame = endFrame;
  }
  return ranges;
}

export function frameRangesForInterval(startFrame, endFrame, chunkCount) {
  if (!Number.isInteger(startFrame) || !Number.isInteger(endFrame) || startFrame < 0
      || endFrame <= startFrame || !Number.isInteger(chunkCount) || chunkCount <= 0) {
    throw new Error('A nonempty half-open frame interval and positive chunk count are required.');
  }
  const length = endFrame - startFrame;
  return Array.from({ length: chunkCount }, (_, i) => [
    startFrame + Math.floor((length * i) / chunkCount + 0.5),
    startFrame + Math.floor((length * (i + 1)) / chunkCount + 0.5),
  ]);
}

export function audioTrimRange(startFrame, endFrame, fps) {
  if (!Number.isInteger(startFrame) || !Number.isInteger(endFrame) || startFrame < 0
      || endFrame <= startFrame || !Number.isInteger(fps) || fps <= 0) {
    throw new Error('Audio trim requires a valid half-open frame range and positive integer FPS.');
  }
  return { start_seconds: startFrame / fps, duration_seconds: (endFrame - startFrame) / fps };
}

export function sceneAudioFilter(startFrame, endFrame, fps) {
  const range = audioTrimRange(startFrame, endFrame, fps);
  return `atrim=start=${range.start_seconds.toFixed(9)}:duration=${range.duration_seconds.toFixed(9)},asetpts=PTS-STARTPTS,apad,atrim=duration=${range.duration_seconds.toFixed(9)}`;
}
