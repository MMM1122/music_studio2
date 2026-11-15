import { uid, type MidiNote } from "./models";

/** Names used for key signatures. Project keys are stored as "<root> minor|major". */
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
const SHARP_NAMES = [
  "C",
  "C♯",
  "D",
  "D♯",
  "E",
  "F",
  "F♯",
  "G",
  "G♯",
  "A",
  "A♯",
  "B",
];
const FLAT_NAMES = [
  "C",
  "D♭",
  "D",
  "E♭",
  "E",
  "F",
  "G♭",
  "G",
  "A♭",
  "A",
  "B♭",
  "B",
];
const LETTERS: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};
export const KEYS = PITCH_NAMES.flatMap((name) => [
  `${name} minor`,
  `${name} major`,
]);

export type Mode = "major" | "minor";
export interface KeyInfo {
  root: number;
  mode: Mode;
  /** Whether accidentals in this key are conventionally written as flats. */
  flats: boolean;
}
export const pitchClass = (pitch: number): number => ((pitch % 12) + 12) % 12;

/** Accepts "E♭ minor", "Eb minor", "C# major", "F♯ major"… Unknown roots fall back to C. */
export function parseKey(key: string): KeyInfo {
  const words = key.trim().split(/\s+/);
  const name = words[0] ?? "C";
  const letter = name.charAt(0).toUpperCase();
  const accidental = name.slice(1);
  const sharp = /^[♯#]/.test(accidental);
  const flat = /^[♭b]/.test(accidental);
  const base = LETTERS[letter] ?? 0;
  const root = pitchClass(base + (sharp ? 1 : flat ? -1 : 0));
  const mode: Mode = key.toLowerCase().includes("minor") ? "minor" : "major";
  const flats = flat
    ? true
    : sharp
      ? false
      : mode === "major"
        ? letter === "F"
        : ["C", "D", "F", "G"].includes(letter);
  return { root, mode, flats };
}
export function keyRoot(key: string): number {
  return parseKey(key).root;
}
export const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
export const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];
export function scalePitchClasses(key: string): number[] {
  const { root, mode } = parseKey(key);
  return (mode === "minor" ? MINOR_SCALE : MAJOR_SCALE).map(
    (interval) => (interval + root) % 12,
  );
}
export function isInScale(pitch: number, key: string): boolean {
  return scalePitchClasses(key).includes(pitchClass(pitch));
}
/** Pitch-class name spelled for the key: E♭ in C minor, D♯ in E major. */
export function pitchClassName(pc: number, key?: string): string {
  const index = pitchClass(pc);
  if (!key) return PITCH_NAMES[index];
  return (parseKey(key).flats ? FLAT_NAMES : SHARP_NAMES)[index];
}
export function noteName(pitch: number, key?: string): string {
  return `${pitchClassName(pitch, key)}${Math.floor(pitch / 12) - 1}`;
}
/** Nearest pitch at or above `pitch` that belongs to the scale. */
export function snapToScale(pitch: number, key: string, direction = 1): number {
  const scale = scalePitchClasses(key);
  let value = Math.round(pitch);
  for (let step = 0; step < 12 && !scale.includes(pitchClass(value)); step++)
    value += direction >= 0 ? 1 : -1;
  return Math.min(127, Math.max(0, value));
}

export type ChordQuality =
  | "major"
  | "minor"
  | "maj7"
  | "min7"
  | "7"
  | "maj9"
  | "min9"
  | "9"
  | "min7b5"
  | "dim7"
  | "sus4"
  | "7alt";
export const CHORD_INTERVALS: Record<ChordQuality, number[]> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  "7": [0, 4, 7, 10],
  maj9: [0, 4, 7, 11, 14],
  min9: [0, 3, 7, 10, 14],
  "9": [0, 4, 7, 10, 14],
  min7b5: [0, 3, 6, 10],
  dim7: [0, 3, 6, 9],
  sus4: [0, 5, 7],
  "7alt": [0, 4, 8, 10, 13],
};
export const CHORD_SYMBOLS: Record<ChordQuality, string> = {
  major: "",
  minor: "m",
  maj7: "maj7",
  min7: "m7",
  "7": "7",
  maj9: "maj9",
  min9: "m9",
  "9": "9",
  min7b5: "m7♭5",
  dim7: "°7",
  sus4: "sus4",
  "7alt": "7alt",
};
export const CHORD_LABELS: Record<ChordQuality, string> = {
  major: "Major",
  minor: "Minor",
  maj7: "Maj 7",
  min7: "Min 7",
  "7": "Dom 7",
  maj9: "Maj 9",
  min9: "Min 9",
  "9": "Dom 9",
  min7b5: "Min 7♭5",
  dim7: "Dim 7",
  sus4: "Sus 4",
  "7alt": "7 alt",
};
export function isChordQuality(value: string): value is ChordQuality {
  return Object.hasOwn(CHORD_INTERVALS, value);
}
export function chordSymbol(
  root: number,
  quality: ChordQuality,
  key?: string,
): string {
  return `${pitchClassName(root, key)}${CHORD_SYMBOLS[quality]}`;
}
export function chordPitches(root: number, quality: ChordQuality): number[] {
  return CHORD_INTERVALS[quality].map((interval) =>
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

export interface DiatonicChord {
  /** Scale degree, 0-based. */
  degree: number;
  roman: string;
  root: number;
  quality: ChordQuality;
}
const MAJOR_DEGREES: [string, ChordQuality][] = [
  ["I", "maj7"],
  ["ii", "min7"],
  ["iii", "min7"],
  ["IV", "maj7"],
  ["V", "7"],
  ["vi", "min7"],
  ["vii", "min7b5"],
];
// Natural minor, with the dominant borrowed from harmonic minor so V resolves home.
const MINOR_DEGREES: [string, ChordQuality][] = [
  ["i", "min7"],
  ["ii", "min7b5"],
  ["III", "maj7"],
  ["iv", "min7"],
  ["V", "7"],
  ["VI", "maj7"],
  ["VII", "7"],
];
/** The seven seventh chords that belong to a key, in scale order. */
export function diatonicChords(key: string): DiatonicChord[] {
  const { root, mode } = parseKey(key);
  const scale = mode === "minor" ? MINOR_SCALE : MAJOR_SCALE;
  const table = mode === "minor" ? MINOR_DEGREES : MAJOR_DEGREES;
  return table.map(([roman, quality], degree) => ({
    degree,
    roman,
    root: (root + scale[degree]) % 12,
    quality,
  }));
}
