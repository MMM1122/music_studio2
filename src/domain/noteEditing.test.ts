import { describe, expect, it } from "vitest";
import {
  createEditedNote,
  buildEditorChord,
  duplicateSelectedNotes,
  moveSelectedNotes,
  quantizeSelectedNotes,
  resizeEditedNote,
} from "./noteEditing";
import type { MidiNote } from "./models";
const notes: MidiNote[] = [
  { id: "a", pitch: 60, startTick: 120, durationTicks: 480, velocity: 0.8 },
  { id: "b", pitch: 64, startTick: 360, durationTicks: 480, velocity: 0.7 },
];
describe("piano editing rules", () => {
  it("snaps creation while keeping the note in its pattern", () => {
    const note = createEditedNote(60, 1910, 120, 1920);
    expect(note.startTick).toBe(1800);
    expect(note.durationTicks).toBe(120);
  });
  it("clamps groups as a unit and preserves their intervals", () => {
    const moved = moveSelectedNotes(notes, ["a", "b"], -480, 4, 1920);
    expect(moved.map((n) => n.startTick)).toEqual([0, 240]);
    expect(moved.map((n) => n.pitch)).toEqual([64, 68]);
    expect(notes[0].startTick).toBe(120);
  });
  it("does not resize past the pattern boundary", () => {
    expect(resizeEditedNote(notes, "a", 3000, 120, 1920)[0].durationTicks).toBe(
      1800,
    );
  });
  it("duplicates selected notes with unique ids, preserving originals", () => {
    const result = duplicateSelectedNotes(notes, ["a", "b"], 1920, 120);
    expect(result.notes).toHaveLength(4);
    expect(result.ids).toHaveLength(2);
    expect(result.notes[2].startTick).toBe(840);
    expect(result.notes[2].id).not.toBe("a");
  });
  it("quantizes only selected notes", () => {
    const result = quantizeSelectedNotes(notes, ["a"], 480, 1920);
    expect(result[0].startTick).toBe(0);
    expect(result[1].startTick).toBe(360);
  });
  it("inserts close chords at the chosen root and voiced chords around middle C", () => {
    const close = buildEditorChord(60, 500, "min9", 7680);
    expect(close.map((n) => n.pitch)).toEqual([60, 63, 67, 70, 74]);
    expect(close.every((n) => n.startTick === 480)).toBe(true);
    const rootless = buildEditorChord(60, 0, "min9", 7680, "rootless");
    // Rootless voicings leave C to the bass and keep the hand between E3 and F5.
    expect(rootless.map((n) => n.pitch % 12).sort((a, b) => a - b)).toEqual([
      2, 3, 7, 10,
    ]);
    expect(Math.min(...rootless.map((n) => n.pitch))).toBeGreaterThanOrEqual(
      52,
    );
    expect(Math.max(...rootless.map((n) => n.pitch))).toBeLessThanOrEqual(81);
    expect(buildEditorChord(60, 0, "not-a-chord", 1920)).toHaveLength(4);
  });
});
