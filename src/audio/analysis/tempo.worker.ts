import { estimateTempo } from "./tempo";
self.onmessage = (
  event: MessageEvent<{ pcm: Float32Array; sampleRate: number }>,
) => {
  try {
    self.postMessage({
      result: estimateTempo(event.data.pcm, event.data.sampleRate),
    });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : "Audio analysis failed.",
    });
  }
};
