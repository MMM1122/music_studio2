import { describe, expect, it } from "vitest";
import { BAR } from "./models";
import {
  createDemoProject,
  createMidiClip,
  createNote,
  createPattern,
  createProject,
  createTrack,
} from "./factories";
import {
  duplicateClip,
  duplicatePattern,
  moveNotes,
  quantizeNotes,
} from "./commands";
import {
  arrangementEnd,
  secondsToTicks,
  snapTick,
  ticksToSeconds,
  patternPosition,
} from "./timing";
import { chordPitches, scalePitchClasses } from "./theory";
import { validateProject } from "./validation";
import { generateSuggestions } from "../ai/suggestions";
import { useProjectStore } from "../stores/projectStore";

describe("project and editing domain", () => {
  it("creates a valid 16-bar composition between 30 and 60 seconds", () => {
    const project = createDemoProject();
    expect(validateProject(project)).toEqual(project);
    expect(arrangementEnd(project)).toBe(BAR * 16);
    const seconds = ticksToSeconds(
      arrangementEnd(project),
      project.transport.bpm,
    );
    expect(seconds).toBeGreaterThan(30);
    expect(seconds).toBeLessThan(60);
    expect(project.tracks).toHaveLength(5);
    // One track per Morandi accent, so the demo shows the whole palette.
    expect(new Set(project.tracks.map((t) => t.color)).size).toBe(5);
    expect(
      new Set(project.tracks.flatMap((t) => t.clips.map((c) => c.id))).size,
    ).toBe(project.tracks.flatMap((t) => t.clips).length);
  });
  it("keeps linked clip copies separate from source-pattern copies", () => {
    const pattern = createPattern();
    pattern.notes = [createNote(60, 0, 480)];
    const clip = createMidiClip(pattern);
    const copied = duplicateClip(clip);
    const sourceCopy = duplicatePattern(pattern);
    expect(copied.id).not.toBe(clip.id);
    expect(copied.startTick).toBe(clip.durationTicks);
    expect(copied.type === "midi" && copied.patternId).toBe(pattern.id);
    expect(sourceCopy.id).not.toBe(pattern.id);
    expect(sourceCopy.notes[0].id).not.toBe(pattern.notes[0].id);
    sourceCopy.notes[0].pitch = 72;
    expect(pattern.notes[0].pitch).toBe(60);
  });
  it("moves a selected chord as a rigid group while respecting pattern and MIDI bounds", () => {
    const pattern = createPattern();
    pattern.notes = [createNote(1, 0, 480), createNote(4, 480, 480)];
    moveNotes(
      pattern,
      pattern.notes.map((n) => n.id),
      -480,
      -4,
    );
    expect(pattern.notes.map((n) => n.startTick)).toEqual([0, 480]);
    expect(pattern.notes.map((n) => n.pitch)).toEqual([0, 3]);
    moveNotes(
      pattern,
      pattern.notes.map((n) => n.id),
      BAR * 10,
      200,
    );
    expect(
      Math.max(...pattern.notes.map((n) => n.startTick + n.durationTicks)),
    ).toBe(pattern.lengthTicks);
    expect(pattern.notes[1].pitch).toBe(127);
  });
  it("quantizes only selected notes and clips note ends to pattern boundaries", () => {
    const pattern = createPattern("midi", BAR);
    pattern.notes = [createNote(60, 1870, 50), createNote(64, 65, 120)];
    quantizeNotes(pattern, [pattern.notes[0].id], 120);
    expect(pattern.notes[0].startTick).toBeLessThan(pattern.lengthTicks);
    expect(
      pattern.notes[0].startTick + pattern.notes[0].durationTicks,
    ).toBeLessThanOrEqual(pattern.lengthTicks);
    expect(pattern.notes[1].startTick).toBe(65);
  });
  it("round-trips musical time with integer tick positions", () => {
    for (const bpm of [30, 86, 90, 300])
      for (const tick of [0, 120, BAR, BAR * 16])
        expect(secondsToTicks(ticksToSeconds(tick, bpm), bpm)).toBe(tick);
    expect(snapTick(190, 120)).toBe(240);
    expect(snapTick(-5, 120)).toBe(0);
  });
  it("builds common sevenths/ninths and transposed scales", () => {
    expect(chordPitches(60, "min9")).toEqual([60, 63, 67, 70, 74]);
    expect(scalePitchClasses("D minor")).toEqual([2, 4, 5, 7, 9, 10, 0]);
  });
  it("rejects unsupported versions, malformed notes, and dangling pattern refs", () => {
    expect(() =>
      validateProject({ ...createProject(), schemaVersion: 2 }),
    ).toThrow("unsupported");
    const project = createDemoProject();
    const pattern = Object.values(project.patterns)[0];
    pattern.notes[0].pitch = 128;
    expect(() => validateProject(project)).toThrow();
    const dangling = createDemoProject();
    dangling.patterns = {};
    expect(() => validateProject(dangling)).toThrow("missing MIDI pattern");
  });
  it("makes all six local idea categories valid without credentials and without editing input", () => {
    const project = createDemoProject();
    const snapshot = JSON.stringify(project);
    const source = Object.values(project.patterns).find(
      (p) => p.kind === "midi",
    )!;
    for (const category of [
      "bassline",
      "melody",
      "chords",
      "drums",
      "rhythm",
      "continue",
    ] as const) {
      const ideas = generateSuggestions(project, category, 42, source);
      expect(ideas).toHaveLength(3);
      for (const idea of ideas) {
        const track = createTrack(idea.instrument);
        project.patterns[idea.pattern.id] = idea.pattern;
        track.clips.push(createMidiClip(idea.pattern));
        const complete = { ...project, tracks: [...project.tracks, track] };
        expect(() => validateProject(complete)).not.toThrow();
        delete project.patterns[idea.pattern.id];
      }
      const first = generateSuggestions(
        project,
        category,
        42,
        source,
      )[0].pattern.notes.map(({ id: _id, ...note }) => note);
      const second = ideas[0].pattern.notes.map(({ id: _id, ...note }) => note);
      expect(first).toEqual(second);
    }
    expect(JSON.stringify(project)).toBe(snapshot);
  });
  it("supports bounded command history and branches after undo without mutating past snapshots", () => {
    useProjectStore.getState().load(createProject());
    useProjectStore.getState().update("Set tempo", (p) => {
      p.transport.bpm = 100;
    });
    useProjectStore.getState().update("Name project", (p) => {
      p.name = "Morning";
    });
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().project.name).toBe("Untitled session");
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().project.transport.bpm).toBe(90);
    useProjectStore.getState().redo();
    expect(useProjectStore.getState().project.transport.bpm).toBe(100);
    useProjectStore.getState().update("New branch", (p) => {
      p.key = "D minor";
    });
    expect(useProjectStore.getState().canRedo).toBe(false);
    for (let i = 0; i < 90; i++)
      useProjectStore.getState().update("Move tempo", (p) => {
        p.transport.bpm = 100 + i;
      });
    expect(useProjectStore.getState().past).toHaveLength(80);
  });
  it("coalesces only explicitly grouped continuous edits and breaks the group on Undo", () => {
    const store = useProjectStore.getState;
    store().load(createProject());
    store().update(
      "Volume",
      (p) => {
        p.masterVolume = 0.6;
      },
      { coalesceKey: "master-volume" },
    );
    store().update(
      "Volume",
      (p) => {
        p.masterVolume = 0.4;
      },
      { coalesceKey: "master-volume" },
    );
    expect(store().past).toHaveLength(1);
    store().undo();
    expect(store().project.masterVolume).toBe(0.8);
    store().update(
      "Volume",
      (p) => {
        p.masterVolume = 0.2;
      },
      { coalesceKey: "master-volume" },
    );
    expect(store().past).toHaveLength(1);
    expect(store().canRedo).toBe(false);
    store().update("Name", (p) => {
      p.name = "Separate command";
    });
    store().update(
      "Volume",
      (p) => {
        p.masterVolume = 0.1;
      },
      { coalesceKey: "master-volume" },
    );
    expect(store().past).toHaveLength(3);
  });
  it("maps song positions into looping patterns, including before the clip starts", () => {
    expect(patternPosition(0, BAR)).toBe(0);
    expect(patternPosition(BAR * 5 + 240, BAR * 4, BAR * 4)).toBe(BAR + 240);
    expect(patternPosition(BAR * 9, BAR * 4, BAR * 4)).toBe(BAR);
    expect(patternPosition(BAR, BAR * 4, BAR * 4)).toBe(BAR);
    expect(patternPosition(100, 0)).toBe(0);
  });
  it("rejects unknown fields and inherited object keys as pattern references", () => {
    expect(() =>
      validateProject({ ...createProject(), silentlyLostField: 1 }),
    ).toThrow();
    const project = createProject();
    const track = createTrack("electric-piano");
    track.clips.push({
      ...createMidiClip(createPattern()),
      patternId: "constructor",
    });
    project.tracks.push(track);
    expect(() => validateProject(project)).toThrow("missing MIDI pattern");
  });
});
