import { describe, expect, it } from "vitest";
import { BAR } from "./models";
import { createDemoProject, createProject } from "./factories";
import {
  detectChord,
  inferProgression,
  pitchedNotesBetween,
  progressionLabel,
  voiceChord,
  voiceProgression,
  type PlacedNote,
} from "./harmony";
import {
  KEYS,
  chordPitches,
  chordSymbol,
  diatonicChords,
  noteName,
  parseKey,
  pitchClass,
  scalePitchClasses,
} from "./theory";
import { generateSuggestions } from "../ai/suggestions";

const held = (pitches: number[]): PlacedNote[] =>
  pitches.map((pitch) => ({
    pitch,
    startTick: 0,
    durationTicks: BAR,
    velocity: 0.7,
  }));

describe("keys and spelling", () => {
  it("reads every key the transport offers, including ♭ and ♯ roots", () => {
    // These are the exact strings stored in projects. Flat and sharp roots used to fall
    // back to C in the piano roll, so ten of the 24 keys highlighted the wrong scale.
    expect(scalePitchClasses("E♭ minor")).toEqual([3, 5, 6, 8, 10, 11, 1]);
    expect(scalePitchClasses("A♭ major")).toEqual([8, 10, 0, 1, 3, 5, 7]);
    expect(scalePitchClasses("F♯ minor")).toEqual([6, 8, 9, 11, 1, 2, 4]);
    expect(scalePitchClasses("Eb major")).toEqual(
      scalePitchClasses("E♭ major"),
    );
    expect(scalePitchClasses("C# minor")).toEqual(
      scalePitchClasses("C♯ minor"),
    );
    for (const key of KEYS) {
      const { root } = parseKey(key);
      expect(scalePitchClasses(key)[0]).toBe(root);
      expect(new Set(scalePitchClasses(key)).size).toBe(7);
    }
    expect(new Set(KEYS.map((key) => parseKey(key).root)).size).toBe(12);
  });
  it("spells notes for the key instead of always using sharps", () => {
    expect(noteName(63, "C minor")).toBe("E♭4");
    expect(noteName(58, "C minor")).toBe("B♭3");
    expect(noteName(63, "E major")).toBe("D♯4");
    expect(noteName(61, "A major")).toBe("C♯4");
    expect(noteName(60)).toBe("C4");
  });
  it("lists the seventh chords that belong to a key", () => {
    const minor = diatonicChords("C minor");
    expect(minor.map((c) => chordSymbol(c.root, c.quality, "C minor"))).toEqual(
      ["Cm7", "Dm7♭5", "E♭maj7", "Fm7", "G7", "A♭maj7", "B♭7"],
    );
    const major = diatonicChords("F major");
    expect(major.map((c) => c.roman)).toEqual([
      "I",
      "ii",
      "iii",
      "IV",
      "V",
      "vi",
      "vii",
    ]);
    expect(chordSymbol(major[3].root, major[3].quality, "F major")).toBe(
      "B♭maj7",
    );
  });
});

describe("reading harmony from notes", () => {
  it("names plain and extended chords", () => {
    expect(detectChord(held([60, 64, 67]), 0, BAR)).toEqual({
      root: 0,
      quality: "major",
    });
    expect(detectChord(held([55, 59, 62, 65]), 0, BAR)).toEqual({
      root: 7,
      quality: "7",
    });
    expect(detectChord(held([57, 60, 64, 67]), 0, BAR)).toEqual({
      root: 9,
      quality: "min7",
    });
  });
  it("lets the bass decide what a rootless voicing is", () => {
    const rootless = [51, 55, 58, 62];
    expect(detectChord(held(rootless), 0, BAR)).toEqual({
      root: 3,
      quality: "maj7",
    });
    expect(detectChord(held([36, ...rootless]), 0, BAR)).toEqual({
      root: 0,
      quality: "min9",
    });
  });
  it("needs at least two pitch classes and ignores drums and muted tracks", () => {
    expect(detectChord(held([60]), 0, BAR)).toBeNull();
    const demo = createDemoProject();
    const everything = pitchedNotesBetween(demo, 0, BAR * 16);
    expect(everything.length).toBeGreaterThan(100);
    expect(everything.every((note) => note.pitch < 90)).toBe(true);
    for (const track of demo.tracks) track.mixer.mute = true;
    expect(pitchedNotesBetween(demo, 0, BAR * 16)).toEqual([]);
  });
  it("reads the demo's chords bar by bar, in both sections", () => {
    const demo = createDemoProject();
    const home = inferProgression(demo, BAR * 4, 4);
    expect(home.fromSong).toBe(true);
    expect(home.spans.map((chord) => chord.root)).toEqual([0, 8, 3, 7]);
    expect(home.spans[0].quality).toBe("min9");
    const lift = inferProgression(demo, BAR * 8, 4);
    expect(lift.spans.map((chord) => chord.root)).toEqual([5, 10, 3, 7]);
    console.log(
      "Demo harmony:",
      progressionLabel(home.spans, demo.key),
      "|",
      progressionLabel(lift.spans, demo.key),
    );
  });
  it("falls back to the key when the song has no harmony yet", () => {
    const empty = inferProgression(createProject(), 0, 4);
    expect(empty.fromSong).toBe(false);
    expect(progressionLabel(empty.spans, "C minor")).toBe(
      "Cm9 · A♭maj7 · E♭maj9 · G7",
    );
    expect(
      inferProgression({ key: "G major" }, 0, 4).spans.map((c) => c.root),
    ).toEqual([7, 4, 0, 2]);
  });
});

describe("voicing", () => {
  it("keeps voicings in the hand's range and leaves the root to the bass", () => {
    const voiced = voiceChord({ root: 0, quality: "min9" }, "rootless");
    expect(voiced.map(pitchClass).sort((a, b) => a - b)).toEqual([2, 3, 7, 10]);
    expect(Math.min(...voiced)).toBeGreaterThanOrEqual(52);
    expect(Math.max(...voiced)).toBeLessThanOrEqual(81);
    expect(voiceChord({ root: 0, quality: "maj7" }, "shell")).toHaveLength(3);
  });
  it("moves each chord to the next by smaller steps than root position does", () => {
    const chords = inferProgression(createDemoProject(), BAR * 4, 4).spans;
    const travel = (voicings: number[][]) =>
      voicings
        .slice(1)
        .map((voicing, index) =>
          voicing.reduce(
            (sum, pitch) =>
              sum +
              Math.min(...voicings[index].map((p) => Math.abs(p - pitch))),
            0,
          ),
        );
    const led = travel(voiceProgression(chords, "rootless"));
    const rootPosition = travel(
      chords.map((chord) => chordPitches(48 + chord.root, chord.quality)),
    );
    console.log("Voice leading (semitones per change):", { led, rootPosition });
    const total = (values: number[]) => values.reduce((a, b) => a + b, 0);
    expect(Math.max(...led)).toBeLessThanOrEqual(10);
    expect(total(led)).toBeLessThan(total(rootPosition));
  });
});

describe("ideas that fit the song", () => {
  const demo = createDemoProject();
  it("writes basslines on the roots of the chords being played", () => {
    for (const [atTick, roots] of [
      [BAR * 4, [0, 8, 3, 7]],
      [BAR * 8, [5, 10, 3, 7]],
    ] as const) {
      for (const idea of generateSuggestions(
        demo,
        "bassline",
        7,
        undefined,
        atTick,
      )) {
        const downbeats = [0, 1, 2, 3].map(
          (bar) =>
            idea.pattern.notes.find((note) => note.startTick === bar * BAR)!
              .pitch,
        );
        expect(downbeats.map(pitchClass)).toEqual(roots);
        expect(
          Math.max(...idea.pattern.notes.map((n) => n.pitch)),
        ).toBeLessThan(60);
        expect(idea.description).toContain("Follows");
      }
    }
  });
  it("lands melody notes on chord tones and keeps passing notes in key", () => {
    const scale = scalePitchClasses(demo.key);
    const chords = inferProgression(demo, BAR * 4, 4).spans;
    for (const idea of generateSuggestions(
      demo,
      "melody",
      3,
      undefined,
      BAR * 4,
    )) {
      for (let bar = 0; bar < 4; bar++) {
        const inBar = idea.pattern.notes
          .filter((n) => Math.floor(n.startTick / BAR) === bar)
          .sort((a, b) => a.startTick - b.startTick);
        expect(inBar.length).toBeGreaterThan(0);
        const root = chords[bar].root;
        const tones = [0, 3, 4, 7, 10, 11, 2, 8, 1].map((i) => (root + i) % 12);
        expect(tones).toContain(pitchClass(inBar[0].pitch));
        expect(tones).toContain(pitchClass(inBar.at(-1)!.pitch));
        for (const note of inBar)
          expect(
            scale.includes(pitchClass(note.pitch)) ||
              tones.includes(pitchClass(note.pitch)),
          ).toBe(true);
      }
      const pitches = idea.pattern.notes.map((n) => n.pitch);
      expect(Math.min(...pitches)).toBeGreaterThanOrEqual(60);
      expect(Math.max(...pitches)).toBeLessThanOrEqual(84);
    }
  });
  it("suggests the key's own progression for an empty project and says so", () => {
    const ideas = generateSuggestions(createProject(), "chords", 1);
    expect(ideas[0].description).toContain(
      "Suggests Cm9 · A♭maj7 · E♭maj9 · G7",
    );
    expect(ideas.map((idea) => idea.pattern.notes.length)).toEqual([
      20, 40, 32,
    ]);
  });
  it("writes two-bar drum grooves whose second bar turns around", () => {
    for (const idea of generateSuggestions(demo, "drums", 5)) {
      expect(idea.pattern.kind).toBe("drums");
      expect(idea.pattern.lengthTicks).toBe(BAR * 2);
      const first = idea.pattern.notes.filter((n) => n.startTick < BAR).length;
      const second = idea.pattern.notes.length - first;
      expect(second).toBeGreaterThanOrEqual(first);
      expect(idea.pattern.notes.some((n) => n.velocity < 0.3)).toBe(true);
      expect(idea.pattern.notes.some((n) => n.velocity > 0.8)).toBe(true);
    }
  });
});
