import { BAR, PPQ, uid } from "./models";
import type { MidiNote } from "./models";
import { voiceChord, type VoicingStyle } from "./harmony";
import { CHORD_INTERVALS, isChordQuality, type ChordQuality } from "./theory";

export const snapNoteTick = (tick: number, snap: number) =>
  Math.max(0, Math.round(tick / snap) * snap);
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
export function buildEditorChord(
  root: number,
  tick: number,
  quality: string,
  length: number,
  style: VoicingStyle = "close",
): MidiNote[] {
  const chordQuality: ChordQuality = isChordQuality(quality) ? quality : "min7";
  const startTick = Math.min(
    Math.max(0, length - PPQ),
    Math.max(0, Math.floor(tick / PPQ) * PPQ),
  );
  // Close position keeps the root where the user put it; the other styles voice the chord
  // around middle C the way a keyboard player would.
  const pitches =
    style === "close"
      ? CHORD_INTERVALS[chordQuality].map((offset) => root + offset)
      : voiceChord({ root: root % 12, quality: chordQuality }, style, null);
  return pitches.map((pitch, i) => ({
    id: uid(),
    pitch: Math.min(127, Math.max(0, pitch)),
    startTick,
    durationTicks: Math.min(BAR, length - startTick),
    velocity: Math.max(0.3, 0.74 - i * 0.035),
  }));
}
