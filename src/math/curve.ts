import { createNote, createPattern } from "../domain/factories";
import { scaleNotes, type FunctionSettings } from "./functions";
/** Piecewise-linear control curve, with one normalized value per eighth-note step. */
export function curvePattern(settings: FunctionSettings, points: number[]) {
  if (points.length !== 16 || points.some((v) => !Number.isFinite(v)))
    throw new Error("A curve needs 16 finite control points.");
  const pattern = createPattern("midi", 3840);
  pattern.name = "Curve study";
  const scale = scaleNotes(
    settings.root,
    settings.scale,
    settings.octave,
    settings.octaves,
  );
  points.forEach((v, i) => {
    const value = Math.max(0, Math.min(1, v));
    if (settings.density && value < 0.32 && i % 4 !== 0) return;
    pattern.notes.push(
      createNote(
        scale[Math.round(value * (scale.length - 1))],
        i * 240,
        210,
        settings.velocityMapping ? 0.35 + 0.55 * value : 0.72,
      ),
    );
  });
  return pattern;
}
export function editCurvePoint(points: number[], index: number, value: number) {
  return points.map((p, i) =>
    i === index ? Math.max(0, Math.min(1, value)) : p,
  );
}
