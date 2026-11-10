/** Aggregate captured-frame progress for exact, non-overlapping render chunk ranges. */
export class RenderProgressTracker {
  constructor(ranges, totalFrames) {
    if (!Number.isInteger(totalFrames) || totalFrames <= 0 || !Array.isArray(ranges) || ranges.length === 0) {
      throw new Error('A positive total frame count and at least one chunk range are required.');
    }
    let next = 0;
    this.totalFrames = totalFrames;
    this.chunks = ranges.map(([start, end], id) => {
      if (!Number.isInteger(start) || !Number.isInteger(end) || start !== next || end <= start || end > totalFrames) {
        throw new Error('Chunk ranges must cover the timeline contiguously with positive frame counts.');
      }
      next = end;
      return { id, start, end, frames: 0, state: 'pending' };
    });
    if (next !== totalFrames) throw new Error('Chunk ranges must cover every frame.');
  }

  report(id, completedFrames) {
    const chunk = this.#chunk(id);
    if (chunk.state === 'failed' || chunk.state === 'complete') return this.snapshot();
    if (!Number.isInteger(completedFrames) || completedFrames < 0) return this.snapshot();
    chunk.frames = Math.max(chunk.frames, Math.min(completedFrames, chunk.end - chunk.start));
    chunk.state = 'rendering';
    return this.snapshot();
  }

  complete(id, verifiedFrameCount) {
    const chunk = this.#chunk(id);
    const expected = chunk.end - chunk.start;
    if (chunk.state === 'failed') throw new Error(`Chunk ${id} has failed and cannot be marked complete.`);
    if (verifiedFrameCount !== expected) throw new Error(`Chunk ${id} has ${verifiedFrameCount} frames; expected exactly ${expected}.`);
    chunk.frames = expected;
    chunk.state = 'complete';
    return this.snapshot();
  }

  fail(id) {
    const chunk = this.#chunk(id);
    if (chunk.state !== 'complete') chunk.state = 'failed';
    return this.snapshot();
  }

  snapshot() {
    const completedFrames = this.chunks.reduce((sum, chunk) => sum + chunk.frames, 0);
    const completedChunks = this.chunks.filter((chunk) => chunk.state === 'complete').length;
    const allChunksComplete = completedChunks === this.chunks.length && completedFrames === this.totalFrames;
    return {
      completed_frames: completedFrames,
      total_frames: this.totalFrames,
      completed_chunks: completedChunks,
      total_chunks: this.chunks.length,
      all_chunks_complete: allChunksComplete,
    };
  }

  #chunk(id) {
    const chunk = this.chunks[id];
    if (!chunk) throw new Error(`Unknown render chunk ${id}.`);
    return chunk;
  }
}
