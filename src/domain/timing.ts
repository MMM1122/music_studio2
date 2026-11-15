import { BAR, PPQ, type Project } from "./models";

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));
export function snapTick(tick: number, resolution = PPQ / 4): number {
  if (!Number.isFinite(tick) || !Number.isFinite(resolution) || resolution <= 0)
    return 0;
  return Math.max(0, Math.round(tick / resolution) * Math.round(resolution));
}
export function ticksToSeconds(ticks: number, bpm: number): number {
  return (ticks * 60) / (Math.max(1, bpm) * PPQ);
}
export function secondsToTicks(seconds: number, bpm: number): number {
  return Math.round((seconds * Math.max(1, bpm) * PPQ) / 60);
}
export function arrangementEnd(project: Project): number {
  return Math.max(
    BAR,
    ...project.tracks.flatMap((track) =>
      track.clips.map((clip) => clip.startTick + clip.durationTicks),
    ),
  );
}
export function formatPosition(tick: number): string {
  const integer = Math.floor(Math.max(0, tick));
  return `${String(Math.floor(integer / BAR) + 1).padStart(2, "0")}.${Math.floor((integer % BAR) / PPQ) + 1}.${String(Math.floor((integer % PPQ) / (PPQ / 4)) + 1).padStart(2, "0")}`;
}
export function formatDuration(tick: number, bpm: number): string {
  const seconds = Math.floor(ticksToSeconds(tick, bpm));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
