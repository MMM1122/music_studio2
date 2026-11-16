import { createNote, createPattern } from "../domain/factories";
import { compileExpression } from "./expression";
export type LabScale = "major" | "minor" | "pentatonic";
export interface MusicSettings {
  root: number;
  scale: LabScale;
  octave: number;
  octaves: number;
  bpm: number;
}
export interface FunctionSettings extends MusicSettings {
  expression: string;
  amplitude: number;
  frequency: number;
  offset: number;
  velocityMapping: boolean;
  density: boolean;
}
export const SCALE_INTERVALS: Record<LabScale, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentatonic: [0, 3, 5, 7, 10],
};
export const DEFAULT_FUNCTION_SETTINGS: FunctionSettings = {
  root: 2,
  scale: "minor",
  octave: 4,
  octaves: 2,
  bpm: 80,
  expression: "sin(x)",
  amplitude: 1,
  frequency: 1,
  offset: 0,
  velocityMapping: false,
  density: false,
};
export function midiToFrequency(pitch: number) {
  return 440 * 2 ** ((pitch - 69) / 12);
}
export function scaleNotes(
  root: number,
  scale: LabScale,
  octave: number,
  octaves: number,
): number[] {
  const notes: number[] = [];
  for (let o = 0; o < octaves; o++)
    for (const step of SCALE_INTERVALS[scale]) {
      const pitch = (octave + o + 1) * 12 + root + step;
      if (pitch >= 0 && pitch <= 127) notes.push(pitch);
    }
  return notes;
}
export function normalizeValues(values: number[]): number[] {
  if (!values.length) return [];
  if (values.some((v) => !Number.isFinite(v)))
    throw new Error("Function values must be finite.");
  const low = Math.min(...values),
    high = Math.max(...values);
  return values.map((v) =>
    high - low < 1e-9 ? 0.5 : (v - low) / (high - low),
  );
}
export function generateFunction(s: FunctionSettings) {
  const fn = compileExpression(s.expression);
  const rawBase = Array.from({ length: 16 }, (_, i) =>
    fn((s.frequency * 2 * Math.PI * i) / 16),
  );
  // Normalize the shape first, then apply range contrast and register offset.
  const normalized = normalizeValues(rawBase).map((v) =>
    Math.max(0, Math.min(1, (v - 0.5) * s.amplitude + 0.5 + s.offset * 0.5)),
  );
  const raw = rawBase.map((v) => v * s.amplitude + s.offset);
  const pitches = scaleNotes(s.root, s.scale, s.octave, s.octaves);
  if (!pitches.length) throw new Error("Choose a valid octave range.");
  const pattern = createPattern("midi", 3840);
  pattern.name = `Function · ${s.expression.slice(0, 60)}`;
  normalized.forEach((value, i) => {
    if (s.density && value < 0.32 && i % 4 !== 0) return;
    pattern.notes.push(
      createNote(
        pitches[Math.round(value * (pitches.length - 1))],
        i * 240,
        210,
        s.velocityMapping ? 0.35 + value * 0.55 : 0.72,
      ),
    );
  });
  const plot = Array.from({ length: 129 }, (_, i) => {
    const x = (2 * Math.PI * i) / 128;
    return {
      x,
      y: Math.max(
        -1e6,
        Math.min(1e6, s.amplitude * fn(s.frequency * x) + s.offset),
      ),
    };
  });
  return { pattern, plot, normalized, raw };
}
