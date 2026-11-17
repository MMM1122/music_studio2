import { useRef } from "react";
import { editCurvePoint } from "../../math/curve";
export function CurveEditor({
  points,
  onChange,
  onGesture,
}: {
  points: number[];
  onChange: (p: number[]) => void;
  onGesture: () => void;
}) {
  const active = useRef<number | null>(null),
    latest = useRef(points);
  latest.current = points;
  function change(index: number, clientY: number, svg: SVGSVGElement) {
    const transform = svg.getScreenCTM();
    if (!transform) return;
    const y = new DOMPoint(0, clientY).matrixTransform(transform.inverse()).y;
    onChange(editCurvePoint(latest.current, index, (195 - y) / 170));
  }
  const d = points
    .map((v, i) => `${i ? "L" : "M"}${20 + i * 40},${195 - v * 170}`)
    .join(" ");
  return (
    <svg
      className="lab-curve-editor"
      viewBox="0 0 640 220"
      role="group"
      aria-label="Draggable pitch curve"
      onPointerMove={(e) => {
        if (active.current !== null)
          change(active.current, e.clientY, e.currentTarget);
      }}
      onPointerUp={() => {
        active.current = null;
      }}
      onPointerCancel={() => {
        active.current = null;
      }}
    >
      {[0, 0.25, 0.5, 0.75, 1].map((v) => (
        <g key={v}>
          <line x1="20" x2="620" y1={195 - v * 170} y2={195 - v * 170} />
          <text x="0" y={198 - v * 170}>
            {v}
          </text>
        </g>
      ))}
      {points.map((_, i) => (
        <line key={i} x1={20 + i * 40} x2={20 + i * 40} y1="25" y2="195" />
      ))}
      <path d={d} className="lab-curve" />
      {points.map((v, i) => (
        <g key={i}>
          <circle
            cx={20 + i * 40}
            cy={195 - v * 170}
            r="13"
            fill="transparent"
            className="curve-hit"
            role="slider"
            tabIndex={0}
            aria-label={`Curve point ${i + 1}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(v * 100)}
            onPointerDown={(e) => {
              e.preventDefault();
              onGesture();
              active.current = i;
              const svg = e.currentTarget.ownerSVGElement!;
              svg.setPointerCapture(e.pointerId);
              change(i, e.clientY, svg);
            }}
            onKeyDown={(e) => {
              if (["ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) {
                e.preventDefault();
                onGesture();
                onChange(
                  editCurvePoint(
                    points,
                    i,
                    e.key === "Home"
                      ? 0
                      : e.key === "End"
                        ? 1
                        : v + (e.key === "ArrowUp" ? 0.05 : -0.05),
                  ),
                );
              }
            }}
          />
          <circle
            className="curve-dot"
            cx={20 + i * 40}
            cy={195 - v * 170}
            r="3.8"
            pointerEvents="none"
          />
          <text x={20 + i * 40} y="216" textAnchor="middle">
            {i + 1}
          </text>
        </g>
      ))}
    </svg>
  );
}
