import { uid, type MidiNote } from "./models";

export const PITCH_NAMES = [
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
export const KEYS = PITCH_NAMES.flatMap((name) => [
  `${name} minor`,
  `${name} major`,
]);
export function noteName(pitch: number): string {
  return `${PITCH_NAMES[((pitch % 12) + 12) % 12]}${Math.floor(pitch / 12) - 1}`;
}
export function keyRoot(key: string): number {
  const normalized = key
    .split(" ")[0]
    .replaceAll("#", "♯")
    .replace("Db", "C♯")
    .replace("Eb", "E♭")
    .replace("Gb", "F♯")
    .replace("Ab", "A♭")
    .replace("Bb", "B♭");
  return Math.max(0, PITCH_NAMES.indexOf(normalized));
}
export function scalePitchClasses(key: string): number[] {
  const root = keyRoot(key);
  return (
    key.toLowerCase().includes("minor")
      ? [0, 2, 3, 5, 7, 8, 10]
      : [0, 2, 4, 5, 7, 9, 11]
  ).map((n) => (n + root) % 12);
}
export function isInScale(pitch: number, key: string): boolean {
  return scalePitchClasses(key).includes(((pitch % 12) + 12) % 12);
}
export type ChordQuality =
  | "major"
  | "minor"
  | "maj7"
  | "min7"
  | "7"
  | "maj9"
  | "min9";
const INTERVALS: Record<ChordQuality, number[]> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  "7": [0, 4, 7, 10],
  maj9: [0, 4, 7, 11, 14],
  min9: [0, 3, 7, 10, 14],
};
export function chordPitches(root: number, quality: ChordQuality): number[] {
  return INTERVALS[quality].map((interval) =>
    Math.min(127, Math.max(0, root + interval)),
  );
}
export function chordNotes(
  root: number,
  quality: ChordQuality,
  startTick = 0,
  durationTicks = 1920,
  velocity = 0.72,
): MidiNote[] {
  return chordPitches(root, quality).map((pitch) => ({
    id: uid(),
    pitch,
    startTick,
    durationTicks,
    velocity,
  }));
}
