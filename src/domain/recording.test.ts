import { describe, expect, it } from "vitest";
import { BAR, PPQ } from "./models";
import {
  createMidiClip,
  createNote,
  createPattern,
  createProject,
  createTrack,
} from "./factories";
import {
  applyTake,
  parseMidiMessage,
  typedPitch,
  type TakeNote,
} from "./recording";
import { validateProject } from "./validation";

function session() {
  const project = createProject("Take test");
  const keys = createTrack("electric-piano");
  const kit = createTrack("drum-kit");
  project.tracks = [keys, kit];
  return { project, keys, kit };
}
const played = (pitch: number, start: number, end: number): TakeNote => ({
  pitch,
  startTick: start,
  endTick: end,
  velocity: 0.7,
});

describe("recording a take", () => {
  it("puts notes played on an empty track into one bar-aligned clip", () => {
    const { project, keys } = session();
    const result = applyTake(project, keys.id, [
      played(60, BAR * 2 + 470, BAR * 2 + 900),
      played(64, BAR * 3 + 10, BAR * 3 + 500),
    ]);
    expect(result).toMatchObject({ added: 2, dropped: 0 });
    expect(keys.clips).toHaveLength(1);
    const clip = keys.clips[0];
    expect(clip.id).toBe(result.clipId);
    expect(clip.startTick).toBe(BAR * 2);
    expect(clip.durationTicks).toBe(BAR * 2);
    const pattern =
      project.patterns[clip.type === "midi" ? clip.patternId : ""];
    // Starts snap to the sixteenth; the held length is kept as played.
    expect(
      pattern.notes.map((n) => [n.pitch, n.startTick, n.durationTicks]),
    ).toEqual([
      [60, 480, 430],
      [64, BAR, 490],
    ]);
    expect(validateProject(structuredClone(project))).toEqual(project);
  });

  it("keeps exact timing when quantize is off", () => {
    const { project, keys } = session();
    applyTake(project, keys.id, [played(60, 133, 400)], { quantize: 0 });
    const clip = keys.clips[0];
    expect(
      project.patterns[clip.type === "midi" ? clip.patternId : ""].notes[0],
    ).toMatchObject({ startTick: 133, durationTicks: 267 });
  });

  it("overdubs into a looping clip, wrapped to the pattern", () => {
    const { project, keys } = session();
    const pattern = createPattern("midi", BAR);
    pattern.notes.push(createNote(48, 0, 480));
    project.patterns[pattern.id] = pattern;
    const clip = createMidiClip(pattern, BAR * 4);
    clip.durationTicks = BAR * 4;
    keys.clips.push(clip);
    // Played in the third repeat of the one-bar pattern, half a beat in.
    const result = applyTake(project, keys.id, [
      played(67, BAR * 6 + 240, BAR * 6 + 720),
      played(67, BAR * 7 + 240, BAR * 7 + 720), // same place on the next pass: not doubled
    ]);
    expect(result).toMatchObject({ clipId: clip.id, added: 1 });
    expect(keys.clips).toHaveLength(1);
    expect(pattern.notes.map((n) => [n.pitch, n.startTick])).toEqual([
      [48, 0],
      [67, 240],
    ]);
    expect(validateProject(structuredClone(project))).toEqual(project);
  });

  it("never overlaps a following clip and keeps notes on both sides of one", () => {
    const { project, keys } = session();
    const pattern = createPattern("midi", BAR);
    project.patterns[pattern.id] = pattern;
    keys.clips.push(createMidiClip(pattern, BAR * 2));
    const result = applyTake(project, keys.id, [
      played(60, BAR, BAR * 2 + 600), // held into the existing clip: cut at its start
      played(62, BAR * 2 + 480, BAR * 2 + 960), // inside the existing clip: overdubbed
      played(64, BAR * 3 + 480, BAR * 3 + 960), // after it: a second new clip
    ]);
    expect(result).toMatchObject({ added: 3, dropped: 0 });
    const clips = [...keys.clips].sort((a, b) => a.startTick - b.startTick);
    expect(clips.map((c) => [c.startTick, c.durationTicks])).toEqual([
      [BAR, BAR],
      [BAR * 2, BAR],
      [BAR * 3, BAR],
    ]);
    expect(pattern.notes.map((n) => n.pitch)).toEqual([62]);
    const firstTake = clips[0];
    expect(
      project.patterns[firstTake.type === "midi" ? firstTake.patternId : ""]
        .notes[0],
    ).toMatchObject({ pitch: 60, startTick: 0, durationTicks: BAR });
    expect(validateProject(structuredClone(project))).toEqual(project);
  });

  it("grows an unshared pattern into its clip's silent tail, and reports notes it cannot place", () => {
    const { project, keys } = session();
    const own = createPattern("midi", BAR);
    project.patterns[own.id] = own;
    const clip = createMidiClip(own, 0);
    clip.loop = false;
    clip.durationTicks = BAR * 2;
    keys.clips.push(clip);
    expect(
      applyTake(project, keys.id, [played(60, BAR + 480, BAR + 960)]),
    ).toMatchObject({ clipId: clip.id, added: 1, dropped: 0 });
    expect(own.lengthTicks).toBe(BAR * 2);
    expect(own.notes[0]).toMatchObject({ startTick: BAR + 480 });

    const shared = createPattern("midi", BAR);
    project.patterns[shared.id] = shared;
    const long = createMidiClip(shared, BAR * 4);
    long.loop = false;
    long.durationTicks = BAR * 2;
    keys.clips.push(long, createMidiClip(shared, BAR * 8));
    expect(
      applyTake(project, keys.id, [played(60, BAR * 5 + 480, BAR * 5 + 960)]),
    ).toMatchObject({ added: 0, dropped: 1 });
    expect(shared.lengthTicks).toBe(BAR);
    expect(validateProject(structuredClone(project))).toEqual(project);
  });

  it("records drum hits as short notes in a drum pattern", () => {
    const { project, kit } = session();
    applyTake(project, kit.id, [played(36, 0, 5), played(38, 478, 2000)]);
    const clip = kit.clips[0];
    const pattern =
      project.patterns[clip.type === "midi" ? clip.patternId : ""];
    expect(pattern.kind).toBe("drums");
    expect(
      pattern.notes.map((n) => [n.pitch, n.startTick, n.durationTicks]),
    ).toEqual([
      [36, 0, 100],
      [38, 480, 100],
    ]);
  });

  it("ignores empty takes, audio tracks and unknown tracks", () => {
    const { project, keys } = session();
    const audio = createTrack("audio");
    project.tracks.push(audio);
    expect(applyTake(project, keys.id, [])).toEqual({
      clipId: null,
      added: 0,
      dropped: 0,
    });
    expect(applyTake(project, audio.id, [played(60, 0, 100)]).added).toBe(0);
    expect(applyTake(project, "missing", [played(60, 0, 100)]).added).toBe(0);
    expect(Object.keys(project.patterns)).toHaveLength(0);
  });
});

describe("keyboard input", () => {
  it("reads MIDI note messages on any channel", () => {
    expect(parseMidiMessage([0x90, 60, 127])).toEqual({
      type: "on",
      pitch: 60,
      velocity: 1,
    });
    expect(parseMidiMessage([0x93, 64, 64])?.type).toBe("on");
    expect(parseMidiMessage([0x80, 60, 40])).toEqual({
      type: "off",
      pitch: 60,
      velocity: 0,
    });
    // Running keyboards send note-on with velocity 0 instead of note-off.
    expect(parseMidiMessage([0x90, 60, 0])?.type).toBe("off");
    expect(parseMidiMessage([0xb0, 64, 127])).toBeNull(); // sustain pedal
    expect(parseMidiMessage([0xf8])).toBeNull(); // clock
    expect(parseMidiMessage(null)).toBeNull();
  });
  it("maps the home row to notes, and to the kit on drum tracks", () => {
    expect(typedPitch("KeyA", 3, false)).toBe(48);
    expect(typedPitch("KeyW", 3, false)).toBe(49);
    expect(typedPitch("KeyK", 4, false)).toBe(72);
    expect(typedPitch("KeyQ", 3, false)).toBeNull();
    expect(typedPitch("KeyA", 3, true)).toBe(36);
    expect(typedPitch("KeyS", 3, true)).toBe(38);
    expect(typedPitch("KeyW", 3, true)).toBeNull();
    expect(PPQ).toBe(480);
  });
});
