const peakCache = new WeakMap<
  AudioBuffer,
  Promise<Float32Array<ArrayBuffer>>
>();
const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
/** Derived peak arrays are cached outside React/project state. No full PCM copies. */
export function waveformPeaks(
  buffer: AudioBuffer,
): Promise<Float32Array<ArrayBuffer>> {
  const cached = peakCache.get(buffer);
  if (cached) return cached;
  const pending = (async () => {
    const peaks = new Float32Array(4096),
      channels = Array.from({ length: buffer.numberOfChannels }, (_, i) =>
        buffer.getChannelData(i),
      );
    const size = Math.max(1, Math.ceil(buffer.length / peaks.length));
    let work = 0;
    for (let i = 0; i < peaks.length; i++) {
      for (let j = i * size; j < Math.min(buffer.length, (i + 1) * size); j++)
        for (const data of channels)
          peaks[i] = Math.max(peaks[i], Math.abs(data[j]));
      work += size;
      if (work >= 131072) {
        work = 0;
        await breathe();
      }
    }
    return peaks;
  })();
  peakCache.set(buffer, pending);
  return pending;
}
/** Bounded amplitude downsampling for onset analysis; original PCM is never transferred. */
export async function tempoSamples(buffer: AudioBuffer, signal: AbortSignal) {
  const duration = Math.min(180, buffer.duration),
    startSeconds = Math.max(0, (buffer.duration - duration) / 2),
    rate = 4000;
  const pcm = new Float32Array(Math.floor(duration * rate));
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) =>
    buffer.getChannelData(i),
  );
  const stride = buffer.sampleRate / rate,
    offset = Math.floor(startSeconds * buffer.sampleRate);
  for (let i = 0; i < pcm.length; i++) {
    let sum = 0,
      count = 0;
    for (
      let j = offset + Math.floor(i * stride);
      j < Math.min(buffer.length, offset + Math.floor((i + 1) * stride));
      j++
    )
      for (const data of channels) {
        sum += data[j] * data[j];
        count++;
      }
    pcm[i] = Math.sqrt(sum / Math.max(1, count));
    if (i % 16384 === 0) {
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      await breathe();
    }
  }
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
  return { pcm, sampleRate: rate, startSeconds };
}
