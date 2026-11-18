import { useRef } from "react";

const STEP = 24;

interface Props {
  /** Current height of the pane above, in pixels, or null for the automatic default. */
  value: number | null;
  /** Measures the pane above as it is drawn now. */
  measure: () => number;
  /** Largest height that still leaves the pane below usable. */
  max: () => number;
  min?: number;
  onChange: (height: number | null) => void;
  label: string;
}

/** A horizontal split handle. Drag it, or focus it and use the arrow keys; Home and End go to
 * the limits and Enter or a double-click returns to the automatic split. */
export function PaneDivider({
  value,
  measure,
  max,
  min = 120,
  onChange,
  label,
}: Props) {
  const drag = useRef<{ y: number; height: number } | null>(null);
  const clamp = (height: number) =>
    Math.round(Math.max(min, Math.min(Math.max(min, max()), height)));
  const current = () => value ?? measure();
  return (
    <div
      className="pane-divider"
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={Math.round(max())}
      aria-valuenow={Math.round(current())}
      tabIndex={0}
      title="Drag to resize · Double-click to reset"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        drag.current = { y: event.clientY, height: current() };
        document.body.classList.add("is-resizing-panes");
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        onChange(clamp(drag.current.height + event.clientY - drag.current.y));
      }}
      onPointerUp={() => {
        drag.current = null;
        document.body.classList.remove("is-resizing-panes");
      }}
      onLostPointerCapture={() => {
        drag.current = null;
        document.body.classList.remove("is-resizing-panes");
      }}
      onDoubleClick={() => onChange(null)}
      onKeyDown={(event) => {
        const keys: Record<string, () => number | null> = {
          ArrowUp: () => clamp(current() - STEP),
          ArrowDown: () => clamp(current() + STEP),
          Home: () => clamp(min),
          End: () => clamp(max()),
          Enter: () => null,
        };
        const next = keys[event.key];
        if (!next) return;
        event.preventDefault();
        event.stopPropagation();
        onChange(next());
      }}
    >
      <span />
    </div>
  );
}
