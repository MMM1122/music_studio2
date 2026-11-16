import { describe, it, expect } from "vitest";
import { compileExpression } from "./expression";
import {
  generateFunction,
  normalizeValues,
  DEFAULT_FUNCTION_SETTINGS,
  scaleNotes,
  midiToFrequency,
} from "./functions";
import {
  posteriorFor,
  feedback,
  samplingFor,
  contextKey,
  generateBayesianMelody,
  type BayesContext,
} from "./bayesian";
import {
  waveformSamples,
  makeFourierInstrument,
  harmonicLevels,
} from "./fourier";
import { createProject, createTrack } from "../domain/factories";
import { validateProject } from "../domain/validation";
import { insertLabPattern, applyLabInstrument } from "./studio";
import { recoverLabState } from "../stores/mathLabStore";
describe("safe mathematical functions", () => {
  it("evaluates the requested language with mathematical precedence", () => {
    expect(compileExpression("sin(2*x) + 0.5*cos(5*x)")(0)).toBe(0.5);
    expect(compileExpression("exp(-x/5)*sin(4*x)")(1)).toBeCloseTo(
      Math.exp(-0.2) * Math.sin(4),
    );
    expect(compileExpression("-2^2 + 2^3^2")(0)).toBe(508);
  });
  it("rejects executable, unknown, excessive and undefined input", () => {
    for (const s of [
      "x.constructor",
      "alert(1)",
      "(()=>1)()",
      "x=3",
      "[1,2]",
      "sin(x);1",
      "__proto__(x)",
      "(".repeat(30) + "x" + ")".repeat(30),
      "x".repeat(300),
      "1e999",
    ])
      expect(() => compileExpression(s)(1)).toThrow();
    for (const s of ["1/0", "sqrt(-1)", "exp(999)"])
      expect(() => compileExpression(s)(1)).toThrow();
    expect(compileExpression("1e10")(0)).toBe(1e6);
  });
  it("normalizes negative, constant and empty ranges safely", () => {
    expect(normalizeValues([-5, 0, 5])).toEqual([0, 0.5, 1]);
    expect(normalizeValues([8, 8])).toEqual([0.5, 0.5]);
    expect(normalizeValues([])).toEqual([]);
    expect(() => normalizeValues([NaN])).toThrow();
  });
  it("quantizes to the requested scale and converts MIDI frequencies", () => {
    expect(scaleNotes(2, "minor", 4, 1)).toEqual([62, 64, 65, 67, 69, 70, 72]);
    expect(scaleNotes(0, "pentatonic", 4, 1)).toEqual([60, 63, 65, 67, 70]);
    expect(midiToFrequency(69)).toBe(440);
    expect(midiToFrequency(60)).toBeCloseTo(261.6256, 3);
  });
  it("creates 16 valid editable notes, with meaningful shape, amplitude and offset changes", () => {
    const base = generateFunction(DEFAULT_FUNCTION_SETTINGS);
    expect(base.pattern.notes).toHaveLength(16);
    const pitches = base.pattern.notes.map((n) => n.pitch);
    for (const settings of [
      { expression: "x" },
      { amplitude: 0 },
      { offset: 1 },
      { frequency: 2 },
    ])
      expect(
        generateFunction({
          ...DEFAULT_FUNCTION_SETTINGS,
          ...settings,
        }).pattern.notes.map((n) => n.pitch),
      ).not.toEqual(pitches);
    expect(
      generateFunction({ ...DEFAULT_FUNCTION_SETTINGS, density: true }).pattern
        .notes.length,
    ).toBeLessThan(16);
    expect(
      new Set(
        generateFunction({
          ...DEFAULT_FUNCTION_SETTINGS,
          velocityMapping: true,
        }).pattern.notes.map((n) => n.velocity),
      ).size,
    ).toBeGreaterThan(2);
  });
});
describe("Dirichlet evidence and separate preference sampling", () => {
  const c: BayesContext = { root: 2, scale: "minor", chord: 0, previous: 0 };
  it("normalizes both posterior and exploratory distribution", () => {
    for (const scale of ["major", "minor", "pentatonic"] as const) {
      const context = { ...c, scale };
      expect(posteriorFor({}, context).reduce((a, b) => a + b, 0)).toBeCloseTo(
        1,
        12,
      );
      for (const mix of [0, 0.2, 1])
        expect(
          samplingFor({}, context, mix).reduce((a, b) => a + b, 0),
        ).toBeCloseTo(1, 12);
    }
  });
  it("updates one accepted count and isolates contexts", () => {
    const before = posteriorFor({}, c);
    const model = feedback({}, c, 2, true);
    expect(model[contextKey(c)].accepted[2]).toBe(1);
    expect(posteriorFor(model, c)[2]).toBeGreaterThan(before[2]);
    const other = { ...c, previous: 1 };
    expect(posteriorFor(model, other)).toEqual(posteriorFor({}, other));
  });
  it("keeps rejects outside the posterior and lowers draw probability", () => {
    const rejected = feedback({}, c, 2, false);
    expect(posteriorFor(rejected, c)).toEqual(posteriorFor({}, c));
    expect(samplingFor(rejected, c, 0)[2]).toBeLessThan(
      samplingFor({}, c, 0)[2],
    );
    expect(samplingFor(rejected, c, 1)).toEqual(Array(7).fill(1 / 7));
  });
  it("generates reproducible 16-note melodies without self-training", () => {
    const model = {};
    const notes = (seed: number) =>
      generateBayesianMelody(c, model, 16, 0.2, seed).notes.map(
        ({ id: _, ...n }) => n,
      );
    expect(notes(3)).toEqual(notes(3));
    expect(notes(3)).not.toEqual(notes(4));
    expect(notes(3)).toHaveLength(16);
    expect(model).toEqual({});
  });
});
describe("Fourier synthesis and Studio adapter", () => {
  it("generates bounded harmonic shapes and true zero output", () => {
    expect(waveformSamples(Array(8).fill(0)).every((x) => x === 0)).toBe(true);
    const sine = waveformSamples([1, 0, 0, 0, 0, 0, 0, 0], 257);
    expect(sine[64]).toBeCloseTo(1);
    expect(waveformSamples([0, 1, 0, 0, 0, 0, 0, 0], 257)[64]).toBeCloseTo(0);
    expect(Math.max(...waveformSamples(Array(8).fill(1)))).toBeLessThanOrEqual(
      1,
    );
    expect(harmonicLevels([0.25])[0]).toBe(0.25);
  });
  it("inserts detached editable clips, preserves existing tempo and validates saved harmonics", () => {
    const p = createProject();
    p.tracks.push(createTrack("electric-piano"));
    const source = generateFunction(DEFAULT_FUNCTION_SETTINGS).pattern;
    const instrument = makeFourierInstrument(
      [1, 0.4, 0, 0, 0, 0, 0, 0],
      "Saved sound",
    );
    const inserted = insertLabPattern(p, source, instrument, 2050, 80);
    const t = p.tracks.find((t) => t.id === inserted.trackId)!;
    expect(t.clips[0].startTick).toBe(1920);
    expect(p.transport.bpm).toBe(90);
    expect(t.clips[0].type === "midi" && t.clips[0].patternId).not.toBe(
      source.id,
    );
    expect(validateProject(p)).toEqual(p);
    instrument.harmonics![0] = 0;
    expect(t.instrument.harmonics![0]).toBe(1);
  });
  it("sets preview tempo in empty sessions and applies a sound without replacing notes", () => {
    const p = createProject();
    const { pattern } = generateFunction(DEFAULT_FUNCTION_SETTINGS);
    const ids = insertLabPattern(
      p,
      pattern,
      createTrack("electric-piano").instrument,
      0,
      80,
    );
    expect(p.transport.bpm).toBe(80);
    const before = JSON.stringify(p.patterns);
    applyLabInstrument(
      p,
      makeFourierInstrument([1, 0, 0, 0, 0, 0, 0, 0]),
      ids.trackId,
    );
    expect(JSON.stringify(p.patterns)).toBe(before);
    expect(p.tracks[0].instrument.type).toBe("fourier");
  });
  it("recovers corrupt or version-mismatched storage and round-trips valid state", () => {
    for (const raw of [
      "{bad",
      '{"version":2}',
      JSON.stringify({ version: 1, data: {} }),
    ])
      expect(recoverLabState(raw).workspace).toBe("studio");
    const state = recoverLabState(null);
    state.workspace = "math";
    state.tab = "fourier";
    state.bayesModel = feedback(
      {},
      { root: 2, scale: "minor", chord: 0, previous: 0 },
      1,
      true,
    );
    expect(
      recoverLabState(JSON.stringify({ version: 1, data: state })),
    ).toEqual(state);
  });
});
