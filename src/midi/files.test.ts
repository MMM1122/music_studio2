import { describe, it, expect } from "vitest";
import {
  createProject,
  createTrack,
  createPattern,
  createNote,
  createMidiClip,
} from "../domain/factories";
import { exportMidi, readMidi } from "./files";
const buffer = (bytes: Uint8Array) => new Uint8Array(bytes).buffer;
function smf(events: number[], format = 0, division = 480) {
  return new Uint8Array([
    77,
    84,
    104,
    100,
    0,
    0,
    0,
    6,
    0,
    format,
    0,
    1,
    division >> 8,
    division & 255,
    77,
    84,
    114,
    107,
    0,
    0,
    events.length >> 8,
    events.length & 255,
    ...events,
  ]).buffer;
}
describe("MIDI interchange", () => {
  it("round trips looped clips, swing, tempo and independent drum channels", () => {
    const project = createProject("MIDI study");
    project.transport.bpm = 96;
    const track = createTrack("electric-piano"),
      drums = createTrack("drum-kit");
    const pattern = createPattern("midi", 480);
    pattern.swing = 0.5;
    pattern.notes = [
      createNote(60, 0, 120, 0.8),
      createNote(64, 120, 120, 0.6),
    ];
    const clip = createMidiClip(pattern, 960);
    clip.durationTicks = 960;
    track.clips = [clip];
    const beat = createPattern("drums", 480);
    beat.notes = [createNote(36, 0, 60, 0.9)];
    drums.clips = [createMidiClip(beat)];
    project.tracks = [track, drums];
    project.patterns = { [pattern.id]: pattern, [beat.id]: beat };
    const restored = readMidi(buffer(exportMidi(project))).project;
    expect(restored.transport.bpm).toBe(96);
    expect(restored.tracks).toHaveLength(2);
    const melodic = restored.tracks.find((t) => t.type === "midi")!;
    const c = melodic.clips[0];
    if (c.type !== "midi") throw Error();
    expect(
      restored.patterns[c.patternId].notes.map((n) => [
        n.pitch,
        n.startTick,
        n.durationTicks,
      ]),
    ).toEqual([
      [60, 960, 120],
      [64, 1110, 120],
      [60, 1440, 120],
      [64, 1590, 120],
    ]);
    expect(restored.tracks.some((t) => t.type === "drums")).toBe(true);
  });
  it("reads running status, note-on-zero releases and sustain pedal timing", () => {
    const result = readMidi(
      smf([
        0, 0xb0, 64, 127, 0, 0x90, 60, 100, 0, 64, 90, 0x81, 0x70, 60, 0, 0, 64,
        0, 0x81, 0x70, 0xb0, 64, 0, 0, 0xff, 0x2f, 0,
      ]),
    );
    const notes = Object.values(result.project.patterns)[0].notes;
    expect(notes.map((n) => [n.pitch, n.durationTicks])).toEqual([
      [60, 480],
      [64, 480],
    ]);
  });
  it("reports omitted tempo changes and rejects unsupported or damaged files", () => {
    const events = [
      0, 0xff, 0x51, 3, 7, 0xa1, 0x20, 0, 0x90, 60, 90, 0x83, 0x60, 0x80, 60, 0,
      0, 0xff, 0x51, 3, 6, 0x1a, 0x80, 0, 0xff, 0x2f, 0,
    ];
    const result = readMidi(smf(events));
    expect(result.project.transport.bpm).toBe(120);
    expect(result.warnings.join(" ")).toContain("first MIDI tempo");
    expect(() => readMidi(smf(events, 2))).toThrow(/format 2/);
    expect(() => readMidi(smf(events, 0, 0x8020))).toThrow(/SMPTE/);
    expect(() => readMidi(smf(events).slice(0, -1))).toThrow(/Truncated/);
    expect(() => readMidi(smf([0, 60, 100, 0, 0xff, 0x2f, 0]))).toThrow(
      /running status/,
    );
  });
  it("exports only audible tracks and gates notes at the clip boundary", () => {
    const p = createProject(),
      a = createTrack("felt-piano"),
      b = createTrack("synth-bass");
    const pattern = createPattern("midi", 960);
    pattern.notes = [createNote(60, 0, 900)];
    const clip = createMidiClip(pattern);
    clip.durationTicks = 240;
    a.clips = [clip];
    b.clips = [createMidiClip(pattern)];
    b.mixer.mute = true;
    p.tracks = [a, b];
    p.patterns = { [pattern.id]: pattern };
    const restored = readMidi(buffer(exportMidi(p))).project;
    expect(restored.tracks).toHaveLength(1);
    expect(Object.values(restored.patterns)[0].notes[0].durationTicks).toBe(
      240,
    );
    a.mixer.mute = true;
    expect(() => exportMidi(p)).toThrow(/no audible/);
  });
  it("does not reserve melodic channels for empty tracks", () => {
    const p = createProject(),
      track = createTrack("electric-piano"),
      pattern = createPattern("midi", 480);
    pattern.notes = [createNote(60, 0, 120)];
    track.clips = [createMidiClip(pattern)];
    p.tracks = [
      ...Array.from({ length: 16 }, () => createTrack("electric-piano")),
      track,
    ];
    p.patterns = { [pattern.id]: pattern };
    expect(readMidi(buffer(exportMidi(p))).project.tracks).toHaveLength(1);
  });
  it("round trips 128 musical tracks plus their conductor", () => {
    const p = createProject(),
      pattern = createPattern("drums", 480);
    pattern.notes = [createNote(36, 0, 60)];
    p.patterns = { [pattern.id]: pattern };
    p.tracks = Array.from({ length: 128 }, () => {
      const t = createTrack("drum-kit");
      t.clips = [createMidiClip(pattern)];
      return t;
    });
    expect(readMidi(buffer(exportMidi(p))).project.tracks).toHaveLength(128);
  });
  it("holds all-notes-off releases under sustain, but stops all-sound-off immediately", () => {
    const read = (control: number) =>
      readMidi(
        smf([
          0,
          0xb0,
          64,
          127,
          0,
          0xc0,
          38,
          0,
          0x90,
          60,
          100,
          0x81,
          0x70,
          0xb0,
          control,
          0,
          0x81,
          0x70,
          0xb0,
          64,
          0,
          0,
          0xff,
          0x2f,
          0,
        ]),
      ).project;
    const notesOff = read(123),
      soundOff = read(120);
    expect(Object.values(notesOff.patterns)[0].notes[0].durationTicks).toBe(
      480,
    );
    expect(Object.values(soundOff.patterns)[0].notes[0].durationTicks).toBe(
      240,
    );
    expect(notesOff.tracks[0].instrument.type).toBe("synth-bass");
  });
});
