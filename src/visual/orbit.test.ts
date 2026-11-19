import { describe, expect, it } from "vitest";
import { BAR, PPQ, type Project } from "../domain/models";
import {
  createDemoProject,
  createMidiClip,
  createNote,
  createPattern,
  createProject,
  createTrack,
} from "../domain/factories";
import {
  REST_SEPARATION,
  chooseVoices,
  orbitTargets,
  pitchAt,
  restAmount,
  springStep,
} from "./orbit";

/** Two lines over one bar: unison on beat 1, an octave and a fifth on beat 3, silence after. */
function duet(): Project {
  const project = createProject("Duet");
  project.tracks = [];
  project.patterns = {};
  const add = (name: string, notes: [number, number, number][]) => {
    const track = createTrack("electric-piano");
    track.name = name;
    const pattern = createPattern("midi", BAR);
    pattern.notes = notes.map(([p, s, d]) => createNote(p, s, d));
    project.patterns[pattern.id] = pattern;
    track.clips = [{ ...createMidiClip(pattern), loop: false }];
    project.tracks.push(track);
    return track;
  };
  add("High", [
    [72, 0, PPQ],
    [74, PPQ, PPQ],
    [79, PPQ * 2, PPQ],
  ]);
  add("Low", [
    [72, 0, PPQ],
    [65, PPQ, PPQ],
    [60, PPQ * 2, PPQ],
  ]);
  return project;
}

describe("twin orbit", () => {
  it("follows the two most melodic audible lines, upper voice first", () => {
    const score = chooseVoices(createDemoProject());
    expect(score.voices).toHaveLength(2);
    // The melody against the bass, not the chordal keys.
    expect(score.voices.map((v) => v.name)).toEqual([
      "Small hours",
      "Round bass",
    ]);
    expect(score.voices[0].upper).toBe(true);
    expect(score.voices[0].low).toBeGreaterThanOrEqual(score.voices[1].low);
    const drums = createDemoProject().tracks.filter((t) => t.type === "drums");
    for (const voice of score.voices)
      expect(drums.map((t) => t.id)).not.toContain(voice.trackId);
  });

  it("skips muted tracks", () => {
    const project = duet();
    project.tracks[0].mixer.mute = true;
    const score = chooseVoices(project);
    expect(score.voices.map((v) => v.name)).toEqual(["Low"]);
  });

  it("brings the planets together in unison and apart on wide intervals", () => {
    const score = chooseVoices(duet());
    expect(score.closest).toBe(0);
    expect(score.widest).toBe(19);
    const unison = orbitTargets(score, PPQ / 2, true),
      wide = orbitTargets(score, PPQ * 2.5, true);
    expect(unison.separation).toBeLessThan(0.2);
    expect(wide.separation).toBeGreaterThan(0.5);
    expect(wide.a.x).toBeLessThan(unison.a.x);
    expect(wide.b.x).toBeGreaterThan(unison.b.x);
    // The upper voice rose from C5 to G5, so its planet sits higher on screen.
    expect(wide.a.y).toBeLessThan(unison.a.y);
  });

  it("settles to the quiet distance when the phrase ends or playback stops", () => {
    const score = chooseVoices(duet());
    const after = orbitTargets(score, PPQ * 3 + PPQ * 3, true);
    expect(after.rest).toBe(1);
    expect(after.separation).toBeCloseTo(REST_SEPARATION, 5);
    const stopped = orbitTargets(score, PPQ / 2, false);
    expect(stopped.separation).toBeCloseTo(REST_SEPARATION, 5);
    // A short breath inside a phrase is not a phrase end.
    expect(restAmount(PPQ / 4)).toBe(0);
  });

  it("reads the outer note of chords", () => {
    const project = duet();
    const pattern = Object.values(project.patterns)[0];
    pattern.notes.push(createNote(60, 0, PPQ));
    const [upper] = chooseVoices(project).voices;
    expect(pitchAt(upper, 10)).toBe(72);
    expect(pitchAt(upper, PPQ * 3 + 1)).toBeNull();
  });

  it("moves with inertia and settles on the target", () => {
    let x = 0,
      v = 0,
      overshoot = 0;
    for (let i = 0; i < 600; i++) {
      [x, v] = springStep(x, v, 1, 1 / 60);
      overshoot = Math.max(overshoot, x - 1);
    }
    expect(x).toBeCloseTo(1, 3);
    expect(overshoot).toBeGreaterThan(0);
    expect(overshoot).toBeLessThan(0.05);
  });
});
