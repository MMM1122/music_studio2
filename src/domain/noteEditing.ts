import { BAR, PPQ, uid } from "./models";
import type { MidiNote } from "./models";

export const snapNoteTick = (tick: number, snap: number) =>
  Math.max(0, Math.round(tick / snap) * snap);
export const noteLabel = (pitch: number) =>
  `${["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"][pitch % 12]}${Math.floor(pitch / 12) - 1}`;
export const createEditedNote = (
  pitch: number,
  tick: number,
  snap: number,
  length: number,
): MidiNote => {
  const startTick = Math.min(
    Math.max(0, length - snap),
    snapNoteTick(tick, snap),
  );
  return {
    id: uid(),
    pitch: Math.max(0, Math.min(127, Math.round(pitch))),
    startTick,
    durationTicks: Math.min(snap, length - startTick),
    velocity: 0.78,
  };
};
export function moveSelectedNotes(
  notes: MidiNote[],
  ids: string[],
  deltaTicks: number,
  deltaPitch: number,
  length: number,
): MidiNote[] {
  const selected = notes.filter((n) => ids.includes(n.id));
  if (!selected.length) return notes;
  const minTick = Math.min(...selected.map((n) => n.startTick));
  const maxEnd = Math.max(
    ...selected.map((n) => n.startTick + n.durationTicks),
  );
  const dt = Math.max(-minTick, Math.min(length - maxEnd, deltaTicks));
  const dp = Math.max(
    -Math.min(...selected.map((n) => n.pitch)),
    Math.min(127 - Math.max(...selected.map((n) => n.pitch)), deltaPitch),
  );
  return notes.map((n) =>
    ids.includes(n.id)
      ? { ...n, startTick: n.startTick + dt, pitch: n.pitch + dp }
      : n,
  );
}
export function resizeEditedNote(
  notes: MidiNote[],
  id: string,
  duration: number,
  snap: number,
  length: number,
): MidiNote[] {
  return notes.map((n) =>
    n.id === id
      ? {
          ...n,
          durationTicks: Math.max(
            Math.min(snap, length - n.startTick),
            Math.min(length - n.startTick, snapNoteTick(duration, snap)),
          ),
        }
      : n,
  );
}
export function quantizeSelectedNotes(
  notes: MidiNote[],
  ids: string[],
  snap: number,
  length: number,
): MidiNote[] {
  return notes.map((n) =>
    !ids.length || ids.includes(n.id)
      ? {
          ...n,
          startTick: Math.min(
            length - Math.min(n.durationTicks, length),
            snapNoteTick(n.startTick, snap),
          ),
        }
      : n,
  );
}
export function duplicateSelectedNotes(
  notes: MidiNote[],
  ids: string[],
  length: number,
  snap: number,
): { notes: MidiNote[]; ids: string[] } {
  const selected = notes.filter((n) => ids.includes(n.id));
  if (!selected.length) return { notes, ids: [] };
  const start = Math.min(...selected.map((n) => n.startTick));
  const end = Math.max(...selected.map((n) => n.startTick + n.durationTicks));
  const shift = Math.ceil((end - start) / snap) * snap;
  const copies = selected
    .map((n) => ({ ...n, id: uid(), startTick: n.startTick + shift }))
    .filter((n) => n.startTick + n.durationTicks <= length);
  return { notes: [...notes, ...copies], ids: copies.map((n) => n.id) };
}
export function getScaleClasses(key: string): number[] {
  const words = key.trim().split(/\s+/);
  const root =
    (
      {
        C: 0,
        "C#": 1,
        Db: 1,
        D: 2,
        "D#": 3,
        Eb: 3,
        E: 4,
        F: 5,
        "F#": 6,
        Gb: 6,
        G: 7,
        "G#": 8,
        Ab: 8,
        A: 9,
        "A#": 10,
        Bb: 10,
        B: 11,
      } as Record<string, number>
    )[words[0] ?? "C"] ?? 0;
  const intervals = key.toLowerCase().includes("minor")
    ? [0, 2, 3, 5, 7, 8, 10]
    : [0, 2, 4, 5, 7, 9, 11];
  return intervals.map((n) => (n + root) % 12);
}
export function buildEditorChord(
  root: number,
  tick: number,
  quality: string,
  length: number,
): MidiNote[] {
  const intervals: Record<string, number[]> = {
    major: [0, 4, 7],
    minor: [0, 3, 7],
    maj7: [0, 4, 7, 11],
    min7: [0, 3, 7, 10],
    min9: [0, 3, 7, 10, 14],
    maj9: [0, 4, 7, 11, 14],
  };
  const startTick = Math.min(
    Math.max(0, length - PPQ),
    Math.max(0, Math.floor(tick / PPQ) * PPQ),
  );
  return (intervals[quality] ?? intervals.min7).map((offset, i) => ({
    id: uid(),
    pitch: Math.min(127, root + offset),
    startTick,
    durationTicks: Math.min(BAR, length - startTick),
    velocity: 0.74 - i * 0.035,
  }));
}
