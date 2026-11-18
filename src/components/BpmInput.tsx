import { NumberField } from "./NumberField";

export const MIN_BPM = 40;
export const MAX_BPM = 240;

/** The transport tempo field. */
export function BpmInput({
  bpm,
  onChange,
}: {
  bpm: number;
  onChange: (bpm: number) => void;
}) {
  return (
    <NumberField
      label="BPM"
      value={bpm}
      min={MIN_BPM}
      max={MAX_BPM}
      step={1}
      onChange={onChange}
    />
  );
}
