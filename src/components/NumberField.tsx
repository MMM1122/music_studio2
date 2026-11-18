import { useEffect, useRef, useState } from "react";

export interface NumberFieldProps {
  /** Accessible name; also used by tests. */
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number | string;
  /** Decimal places kept when applying (2 by default). */
  precision?: number;
  onChange: (value: number) => void;
  className?: string;
}

const parse = (text: string) => {
  const trimmed = text.trim();
  const value = Number(trimmed);
  return trimmed !== "" && Number.isFinite(value) ? value : null;
};
const show = (value: number) => String(Math.round(value * 10000) / 10000);

/** A number input whose text belongs to the user while they type. Clamping on every keystroke
 * made fields impossible to edit: on the way to 120, "1" became the minimum and "12…" the
 * maximum. Here a value inside the range applies as soon as it is typed; Enter or leaving the
 * field clamps an out-of-range entry; Escape restores the value from before editing; an empty
 * field restores the current value. */
export function NumberField({
  label,
  value,
  min,
  max,
  step,
  precision = 2,
  onChange,
  className,
}: NumberFieldProps) {
  const [draft, setDraft] = useState(show(value));
  const editing = useRef(false);
  const original = useRef(value);
  // Follow changes made elsewhere (undo, another control, opening a project).
  useEffect(() => {
    if (!editing.current) setDraft(show(value));
  }, [value]);
  const factor = 10 ** precision;
  const apply = (next: number) => {
    const clamped =
      Math.round(Math.max(min, Math.min(max, next)) * factor) / factor;
    if (clamped !== value) onChange(clamped);
    return clamped;
  };
  const finish = () => {
    if (!editing.current) return;
    editing.current = false;
    const parsed = parse(draft);
    setDraft(show(parsed === null ? value : apply(parsed)));
  };
  return (
    <input
      aria-label={label}
      className={className}
      type="number"
      inputMode="decimal"
      min={min}
      max={max}
      step={step}
      value={draft}
      onFocus={() => {
        editing.current = true;
        original.current = value;
      }}
      onChange={(event) => {
        editing.current = true;
        const text = event.target.value;
        setDraft(text);
        const parsed = parse(text);
        if (parsed !== null && parsed >= min && parsed <= max) apply(parsed);
      }}
      onBlur={finish}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          finish();
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          event.stopPropagation();
          editing.current = false;
          if (original.current !== value) onChange(original.current);
          setDraft(show(original.current));
          event.currentTarget.blur();
        }
      }}
    />
  );
}
