export function previewStartupTimestamp(sceneDuration, preferredTimestamp = 0.7) {
  if (!Number.isFinite(sceneDuration) || sceneDuration <= 0) return 0;
  const safeEnd = sceneDuration - Math.min(0.001, sceneDuration / 2);
  return Math.max(0, Math.min(preferredTimestamp, safeEnd));
}

export function playbackStartupTimestamp({ previewMode, explicitTimestamp, sceneDuration }) {
  if (explicitTimestamp !== null) return explicitTimestamp;
  return previewMode ? previewStartupTimestamp(sceneDuration) : 0;
}
