import type { Instrument } from "../domain/models";
export const FOURIER_PRESETS = [
  {
    name: "Pure Sine",
    harmonics: [1, 0, 0, 0, 0, 0, 0, 0],
    attack: 0.015,
    release: 0.2,
  },
  {
    name: "Warm Soul Keys",
    harmonics: [1, 0.35, 0.22, 0.08, 0.06, 0.02, 0, 0],
    attack: 0.008,
    release: 0.45,
  },
  {
    name: "Soft Synth Pad",
    harmonics: [1, 0.2, 0.3, 0.1, 0.12, 0.04, 0.06, 0.02],
    attack: 0.35,
    release: 1.1,
  },
  {
    name: "Bright Electronic Lead",
    harmonics: [1, 0.65, 0.45, 0.32, 0.23, 0.17, 0.12, 0.08],
    attack: 0.01,
    release: 0.25,
  },
  {
    name: "Deep Bass",
    harmonics: [1, 0.25, 0.08, 0.04, 0, 0, 0, 0],
    attack: 0.01,
    release: 0.18,
  },
];
export function harmonicLevels(harmonics: number[]): number[] {
  const h = Array.from({ length: 8 }, (_, i) =>
    Math.max(0, Math.min(1, Number.isFinite(harmonics[i]) ? harmonics[i] : 0)),
  );
  const divisor = Math.max(
    1,
    h.reduce((a, b) => a + b, 0),
  );
  return h.map((v) => v / divisor);
}
export function makeFourierInstrument(
  harmonics: number[],
  name = "Custom harmonics",
  attack = 0.015,
  release = 0.3,
): Instrument {
  return {
    type: "fourier",
    harmonics: Array.from({ length: 8 }, (_, i) =>
      Math.max(0, Math.min(1, harmonics[i] || 0)),
    ),
    presetName: name,
    attack,
    release,
    brightness: 0.5,
  };
}
export function waveformSamples(harmonics: number[], count = 256): number[] {
  const h = harmonicLevels(harmonics);
  return Array.from({ length: count }, (_, i) =>
    h.reduce(
      (sum, a, n) =>
        sum + a * Math.sin((2 * Math.PI * (n + 1) * i) / (count - 1)),
      0,
    ),
  );
}
