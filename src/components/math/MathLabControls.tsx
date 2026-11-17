import type { Pattern } from "../../domain/models";
import { createNote } from "../../domain/factories";
import { noteName } from "../../domain/theory";
import type { LabScale } from "../../math/functions";

export const ROOTS = [
  "C",
  "C♯",
  "D",
  "E♭",
  "E",
  "F",
  "F♯",
  "G",
  "A♭",
  "A",
  "B♭",
  "B",
];
const SCALES: { value: LabScale; label: string }[] = [
  { value: "major", label: "Major" },
  { value: "minor", label: "Natural Minor" },
  { value: "pentatonic", label: "Minor Pentatonic" },
];
export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="lab-slider">
      <span>
        {label}
        <output>{value.toFixed(2)}</output>
      </span>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(+e.target.value)}
      />
    </label>
  );
}
export function KeyScale({
  root,
  scale,
  onChange,
}: {
  root: number;
  scale: LabScale;
  onChange: (v: { root?: number; scale?: LabScale }) => void;
}) {
  return (
    <>
      <label>
        Key
        <select
          aria-label="Lab key"
          value={root}
          onChange={(e) => onChange({ root: +e.target.value })}
        >
          {ROOTS.map((r, i) => (
            <option key={r} value={i}>
              {r}
            </option>
          ))}
        </select>
      </label>
      <label>
        Scale
        <select
          aria-label="Lab scale"
          value={scale}
          onChange={(e) => onChange({ scale: e.target.value as LabScale })}
        >
          {SCALES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
export function Graph({
  values,
  label,
  fixed = false,
}: {
  values: number[];
  label: string;
  fixed?: boolean;
}) {
  const low = fixed ? -1 : Math.min(-0.1, ...values),
    high = fixed ? 1 : Math.max(0.1, ...values),
    range = high - low || 1;
  const path = values
    .map(
      (y, i) =>
        `${i ? "L" : "M"}${((i / Math.max(1, values.length - 1)) * 640).toFixed(2)},${(180 - ((y - low) / range) * 160).toFixed(2)}`,
    )
    .join(" ");
  return (
    <svg
      className="lab-graph"
      viewBox="0 0 640 200"
      role="img"
      aria-label={label}
      preserveAspectRatio="none"
    >
      {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
        <line key={"x" + i} x1={i * 80} x2={i * 80} y1={0} y2={200} />
      ))}
      {[20, 60, 100, 140, 180].map((y) => (
        <line key={y} x1={0} x2={640} y1={y} y2={y} />
      ))}
      <path
        className="lab-axis"
        d={`M0,${180 - ((0 - low) / range) * 160}H640`}
      />
      <path className="lab-curve" d={path} />
    </svg>
  );
}
export function Sequence({
  pattern,
  pitches,
  steps,
  onChange,
}: {
  pattern: Pattern;
  pitches: number[];
  steps: number;
  onChange: (p: Pattern) => void;
}) {
  return (
    <div
      className="lab-sequence"
      style={{ gridTemplateColumns: `repeat(${steps}, minmax(46px,1fr))` }}
    >
      {Array.from({ length: steps }, (_, i) => {
        const note = pattern.notes.find(
          (n) => Math.floor(n.startTick / 240) === i,
        );
        const choices = [
          ...new Set([...pitches, ...(note ? [note.pitch] : [])]),
        ].sort((a, b) => a - b);
        return (
          <label className="lab-step" key={i}>
            <span>{String(i + 1).padStart(2, "0")}</span>
            <div className="lab-note-glyph">
              <i
                style={{
                  bottom: `${note ? 10 + (Math.max(0, choices.indexOf(note.pitch)) / Math.max(1, choices.length - 1)) * 65 : 5}%`,
                  opacity: note ? note.velocity : 0,
                }}
              />
            </div>
            <select
              aria-label={`Step ${i + 1} note`}
              value={note?.pitch ?? "rest"}
              onChange={(e) => {
                const next = structuredClone(pattern);
                next.notes = next.notes.filter(
                  (n) => Math.floor(n.startTick / 240) !== i,
                );
                if (e.target.value !== "rest")
                  next.notes.push(
                    createNote(
                      +e.target.value,
                      i * 240,
                      210,
                      note?.velocity ?? 0.72,
                    ),
                  );
                next.notes.sort((a, b) => a.startTick - b.startTick);
                onChange(next);
              }}
            >
              <option value="rest">Rest</option>
              {choices.map((p) => (
                <option key={p} value={p}>
                  {noteName(p)}
                </option>
              ))}
            </select>
          </label>
        );
      })}
    </div>
  );
}
