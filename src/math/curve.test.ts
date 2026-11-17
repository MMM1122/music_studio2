import { describe, expect, it } from "vitest";
import { curvePattern, editCurvePoint } from "./curve";
import {
  DEFAULT_FUNCTION_SETTINGS,
  generateFunction,
  scaleNotes,
} from "./functions";
describe("editable pitch curve", () => {
  it("retains the generated phrase before moving any control point", () => {
    const settings = {
      ...DEFAULT_FUNCTION_SETTINGS,
      density: true,
      velocityMapping: true,
    };
    const initial = generateFunction(settings);
    const meaningful = (notes: typeof initial.pattern.notes) =>
      notes.map(({ id, ...note }) => note);
    expect(
      meaningful(curvePattern(settings, initial.normalized).notes),
    ).toEqual(meaningful(initial.pattern.notes));
  });
  it("moves only the selected step and clamps it to the selected scale", () => {
    const points = Array(16).fill(0.5);
    const moved = editCurvePoint(points, 7, 2);
    const p = curvePattern(DEFAULT_FUNCTION_SETTINGS, moved);
    expect(points[7]).toBe(0.5);
    expect(moved[7]).toBe(1);
    expect(p.notes[7].pitch).toBe(scaleNotes(2, "minor", 4, 2).at(-1));
    expect(p.notes[7].startTick).toBe(1680);
    expect(p.lengthTicks).toBe(3840);
    expect(p.notes.filter((n) => n.pitch === p.notes[0].pitch)).toHaveLength(
      15,
    );
  });
  it("rejects malformed control points instead of generating invalid notes", () => {
    expect(() => curvePattern(DEFAULT_FUNCTION_SETTINGS, [1])).toThrow();
    expect(() =>
      curvePattern(DEFAULT_FUNCTION_SETTINGS, Array(16).fill(NaN)),
    ).toThrow();
  });
});
