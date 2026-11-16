import { createNote, createPattern } from "../domain/factories";
import { SCALE_INTERVALS, type LabScale } from "./functions";
export interface BayesContext {
  root: number;
  scale: LabScale;
  chord: number;
  previous: number;
}
export type BayesModel = Record<
  string,
  { accepted: number[]; rejected: number[] }
>;
export function contextKey(c: BayesContext) {
  return `${c.root}:${c.scale}:${c.chord}:${c.previous}`;
}
export function priorFor(c: BayesContext): number[] {
  const n = SCALE_INTERVALS[c.scale].length;
  return Array.from({ length: n }, (_, i) => {
    const distance = Math.min(
      Math.abs(i - c.previous),
      n - Math.abs(i - c.previous),
    );
    const chord = [c.chord % n, (c.chord + 2) % n, (c.chord + 4) % n];
    return (
      1 +
      (chord.includes(i) ? 2 : 0) +
      (distance === 1 ? 2 : distance === 0 ? 1 : 0)
    );
  });
}
const normalize = (values: number[]) => {
  const sum = values.reduce((a, b) => a + b, 0);
  return values.map((x) => x / sum);
};
export function posteriorFor(model: BayesModel, c: BayesContext): number[] {
  const counts = model[contextKey(c)]?.accepted;
  return normalize(priorFor(c).map((alpha, i) => alpha + (counts?.[i] ?? 0)));
}
/** Rejection is a preference penalty, NOT a Dirichlet conjugate observation.
 * It affects sampling only, followed by a uniform exploration mixture. */
export function samplingFor(
  model: BayesModel,
  c: BayesContext,
  exploration: number,
): number[] {
  const rejected = model[contextKey(c)]?.rejected;
  const p = normalize(
    posteriorFor(model, c).map(
      (v, i) => v * Math.exp(-0.35 * Math.min(50, rejected?.[i] ?? 0)),
    ),
  );
  const mix = Math.max(0, Math.min(1, exploration));
  return p.map((v) => (1 - mix) * v + mix / p.length);
}
export function feedback(
  model: BayesModel,
  c: BayesContext,
  degree: number,
  accepted: boolean,
): BayesModel {
  const key = contextKey(c),
    n = SCALE_INTERVALS[c.scale].length;
  if (!Number.isInteger(degree) || degree < 0 || degree >= n)
    throw new Error("Invalid scale degree.");
  const old = model[key];
  const row = {
    accepted: Array.from({ length: n }, (_, i) => old?.accepted[i] ?? 0),
    rejected: Array.from({ length: n }, (_, i) => old?.rejected[i] ?? 0),
  };
  const list = accepted ? row.accepted : row.rejected;
  list[degree] = Math.min(1e6, list[degree] + 1);
  return { ...model, [key]: row };
}
export function nextDegree(p: number[], random: () => number = Math.random) {
  let at = random();
  for (let i = 0; i < p.length; i++) {
    at -= p[i];
    if (at < 0) return i;
  }
  return p.length - 1;
}
export function generateBayesianMelody(
  context: BayesContext,
  model: BayesModel,
  length: number,
  exploration: number,
  seed: number,
) {
  let state = seed >>> 0;
  const random = () =>
    (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
  const pattern = createPattern("midi", length * 240);
  pattern.name = "Bayesian melody";
  let c = { ...context };
  for (let i = 0; i < length; i++) {
    const degree = nextDegree(samplingFor(model, c, exploration), random);
    pattern.notes.push(
      createNote(
        60 + c.root + SCALE_INTERVALS[c.scale][degree],
        i * 240,
        i === length - 1 ? 230 : 205,
        0.64 + random() * 0.16,
      ),
    );
    c = { ...c, previous: degree };
  }
  return pattern;
}
