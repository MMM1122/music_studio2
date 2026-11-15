import { useEffect } from "react";
import { create } from "zustand";
import { engine } from "../audio/engine";
import { patternPosition } from "../domain/timing";

/** Live playback readings. These change many times a second, so they live apart from the
 * project store: only the few elements that draw a playhead or meter subscribe to them,
 * and the rest of the interface never re-renders because time moved. */
export interface TransportReadings {
  tick: number;
  playing: boolean;
  level: number;
  previewing: boolean;
  previewTick: number;
}
export const useTransportStore = create<TransportReadings>(() => ({
  tick: 0,
  playing: false,
  level: 0,
  previewing: false,
  previewTick: 0,
}));

let frame = 0;
let users = 0;
function read() {
  const state = useTransportStore.getState();
  const tick = engine.getTick();
  const playing = engine.isPlaying();
  const previewing = engine.isPreviewing();
  const previewTick = previewing ? engine.getPreviewTick() : 0;
  // The meter only needs two decimals; coarser values mean fewer store notifications.
  const level = Math.round(engine.getLevel() * 100) / 100;
  if (
    tick !== state.tick ||
    playing !== state.playing ||
    level !== state.level ||
    previewing !== state.previewing ||
    previewTick !== state.previewTick
  )
    useTransportStore.setState({
      tick,
      playing,
      level,
      previewing,
      previewTick,
    });
  frame = requestAnimationFrame(read);
}
/** Starts copying engine readings into the store once per animation frame. Visual only:
 * musical timing is scheduled on the audio clock inside the engine. */
export function startTransportSync(): () => void {
  if (users++ === 0) frame = requestAnimationFrame(read);
  return () => {
    if (--users === 0) cancelAnimationFrame(frame);
  };
}
/** Pushes a reading immediately, for actions whose result should show before the next frame. */
export function refreshTransport(): void {
  useTransportStore.setState({
    tick: engine.getTick(),
    playing: engine.isPlaying(),
    previewing: engine.isPreviewing(),
  });
}

/** Runs `draw` whenever the readings change, without re-rendering the component.
 * Use it to move a playhead or meter by writing to a DOM node directly. */
export function useTransportDraw(
  draw: (readings: TransportReadings) => void,
  deps: readonly unknown[],
): void {
  useEffect(() => {
    draw(useTransportStore.getState());
    return useTransportStore.subscribe(draw);
    // The caller lists what `draw` closes over.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Position inside a pattern being edited: the preview loop when one is running, otherwise the
 * song position mapped into the clip (or the bare pattern when no clip is selected). */
export function editorTick(
  readings: TransportReadings,
  patternLength: number,
  clipStart: number | null,
): number {
  return readings.previewing
    ? patternPosition(readings.previewTick, patternLength)
    : patternPosition(readings.tick, patternLength, clipStart ?? 0);
}
