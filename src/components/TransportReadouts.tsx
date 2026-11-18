import { useRef } from "react";
import { engine } from "../audio/engine";
import { formatPosition } from "../domain/timing";
import { useTransportDraw, useTransportStore } from "../stores/transportStore";

/** Bar.beat.sixteenth readout. Re-renders only when the displayed text changes. */
export function PositionReadout() {
  const text = useTransportStore((state) => formatPosition(state.tick));
  return (
    <div className="transport-position mono" aria-label="Playback position">
      {text}
    </div>
  );
}

/** Output meter, drawn by scaling a bar so playback never re-renders the footer. */
export function LevelMeter() {
  const meter = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLElement>(null);
  useTransportDraw((readings) => {
    if (bar.current)
      bar.current.style.transform = `scaleX(${Math.min(1, readings.level * 1.8).toFixed(3)})`;
    meter.current?.setAttribute(
      "aria-valuenow",
      String(Math.round(readings.level * 100)),
    );
  }, []);
  return (
    <div
      ref={meter}
      className="level-meter"
      role="meter"
      aria-label="Audio output level"
      aria-valuenow={0}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <i ref={bar} />
    </div>
  );
}

/** Arrangement playhead. Moved with a transform on the compositor, never through React. */
export function TimelinePlayhead({ pixelsPerTick }: { pixelsPerTick: number }) {
  const line = useRef<HTMLDivElement>(null);
  useTransportDraw(
    (readings) => {
      if (line.current)
        line.current.style.transform = `translateX(${(readings.tick * pixelsPerTick).toFixed(2)}px)`;
    },
    [pixelsPerTick],
  );
  return (
    <div className="timeline-playhead" ref={line}>
      <i />
    </div>
  );
}

/** A track's own post-fader level: rises at once, falls slowly, so short hits stay visible. */
export function TrackMeter({ trackId }: { trackId: string }) {
  const bar = useRef<HTMLElement>(null);
  const shown = useRef(0);
  useTransportDraw(
    (readings) => {
      const idle =
        !readings.playing && !readings.previewing && readings.level === 0;
      shown.current = idle
        ? 0
        : Math.max(engine.getTrackLevel(trackId), shown.current * 0.86);
      if (bar.current)
        bar.current.style.transform = `scaleX(${Math.min(1, shown.current * 1.5).toFixed(3)})`;
    },
    [trackId],
  );
  return (
    <div className="track-meter" aria-hidden="true">
      <i ref={bar} />
    </div>
  );
}
