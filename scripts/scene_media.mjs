export function validateSceneOutput(info, { frames, width, height, fps }) {
  const streams = Array.isArray(info?.streams) ? info.streams : [];
  const video = streams.find((stream) => stream.codec_type === 'video');
  const hasAudio = streams.some((stream) => stream.codec_type === 'audio');
  const duration = Number(info?.format?.duration);
  const renderedDuration = frames / fps;
  const valid = Boolean(video)
    && Number(video.nb_read_frames) === frames
    && hasAudio
    && Number(video.width) === Number(width)
    && Number(video.height) === Number(height)
    && video.avg_frame_rate === `${fps}/1`
    && Number.isFinite(duration)
    && Math.abs(duration - renderedDuration) <= (1 / fps) + 0.01;
  if (!valid) {
    throw new Error('Final scene MP4 failed frame-count, audio, resolution, FPS, or duration validation.');
  }
  return { rendered_duration: renderedDuration, frames, audio: true };
}
