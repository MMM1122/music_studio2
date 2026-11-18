import { expect, it } from "vitest";
import { estimateTempo } from "./tempo";
function clicks(bpm: number) {
  const rate = 4000,
    pcm = new Float32Array(rate * 24);
  for (let beat = 0.2; beat < 24; beat += 60 / bpm) {
    for (let i = 0; i < 180; i++)
      pcm[Math.floor(beat * rate) + i] = Math.exp(-i / 30) * Math.sin(i * 1.3);
  }
  return pcm;
}
it.each([60, 90, 120, 150, 180])(
  "finds periodic onsets at %i BPM or explicitly lists the metrical alternative",
  (bpm) => {
    const result = estimateTempo(clicks(bpm), 4000);
    expect(result.bpm).not.toBeNull();
    expect(
      Math.min(
        ...[result.bpm!, ...result.alternatives].map((v) => Math.abs(v - bpm)),
      ),
    ).toBeLessThan(2);
    expect(result.confidence).toBeGreaterThan(0.5);
  },
);
it("does not invent tempo for silence, a steady tone or too little audio", () => {
  expect(estimateTempo(new Float32Array(4000 * 20), 4000).bpm).toBeNull();
  const tone = Float32Array.from(
    { length: 4000 * 20 },
    (_, i) => Math.sin((i * 2 * Math.PI * 200) / 4000) * 0.3,
  );
  expect(estimateTempo(tone, 4000).bpm).toBeNull();
  expect(estimateTempo(clicks(120).slice(0, 4000), 4000).bpm).toBeNull();
});
it("bounds work and rejects invalid PCM", () => {
  expect(() => estimateTempo(new Float32Array(4000 * 181), 4000)).toThrow();
  const pcm = clicks(120);
  pcm[123] = NaN;
  expect(() => estimateTempo(pcm, 4000)).toThrow();
});
