import { describe, expect, it } from "vitest";
import { PPQ } from "../domain/models";
import { MelodyTracker, RIPPLE_LIFE, soundingNote } from "./melody";
import type { OrbitScore, OrbitVoice } from "./orbit";

const voice = (
  notes: [number, number, number][],
  upper: boolean,
): OrbitVoice => {
  const list = notes.map(([start, end, pitch]) => ({ start, end, pitch }));
  const pitches = list.map((n) => n.pitch);
  return {
    trackId: upper ? "a" : "b",
    name: upper ? "Melody" : "Bass",
    notes: list,
    longest: Math.max(...list.map((n) => n.end - n.start)),
    low: Math.min(...pitches),
    high: Math.max(...pitches),
    upper,
  };
};
const beat = PPQ;
/** C4 E4 G4 C5, one beat each, over a bass on C2 then G2. */
const score: OrbitScore = {
  voices: [
    voice(
      [
        [0, beat, 60],
        [beat, beat * 2, 64],
        [beat * 2, beat * 3, 67],
        [beat * 3, beat * 4, 72],
      ],
      true,
    ),
    voice(
      [
        [0, beat * 2, 36],
        [beat * 2, beat * 4, 43],
      ],
      false,
    ),
  ],
  closest: 24,
  widest: 36,
};
/** Plays from tick 0 to `until` at 120 bpm in 60 Hz frames. */
function play(tracker: MelodyTracker, until: number, from = 0) {
  const ticksPerFrame = (PPQ * 2) / 60;
  let kicks = 0;
  for (let tick = from; tick < until; tick += ticksPerFrame)
    kicks += tracker.update(score, tick, true, 1 / 60);
  return kicks;
}

describe("melody tracker", () => {
  it("picks the voice's own sounding note", () => {
    const chord = voice(
      [
        [0, beat, 60],
        [0, beat, 67],
      ],
      true,
    );
    expect(soundingNote(chord, 10)?.pitch).toBe(67);
    expect(soundingNote({ ...chord, upper: false }, 10)?.pitch).toBe(60);
    expect(soundingNote(chord, beat + 1)).toBeNull();
  });

  it("sends one ripple per onset from the right galaxy", () => {
    const t = new MelodyTracker();
    play(t, beat * 4);
    expect(t.onsets).toBe(6);
    const hosts = t.ripples.map((r) => r.host);
    expect(hosts.filter((h) => h === 0).length).toBeGreaterThan(0);
    expect(hosts).toContain(1);
  });

  it("lights the arms farther out for higher notes while they sound", () => {
    const t = new MelodyTracker();
    const radii: number[] = [];
    for (const until of [beat * 0.5, beat * 1.5, beat * 2.5, beat * 3.5]) {
      play(t, until, until - beat * 0.5 > 0 ? until - 4 : 0);
      radii.push(
        t.lights.find((l) => l.host === 0 && l.strength === 1)!.radius,
      );
    }
    for (let k = 1; k < radii.length; k++)
      expect(radii[k]).toBeGreaterThan(radii[k - 1]);
    expect(radii[0]).toBeCloseTo(0.22, 2);
    expect(radii[3]).toBeCloseTo(1, 2);
  });

  it("fades the held light after the music stops and lets ripples expire", () => {
    const t = new MelodyTracker();
    play(t, beat * 2);
    expect(t.lights.length).toBeGreaterThan(0);
    for (let k = 0; k < 60 * 3; k++) t.update(score, beat * 2, false, 1 / 60);
    expect(t.lights).toEqual([]);
    expect(t.ripples).toEqual([]);
    expect(RIPPLE_LIFE).toBeLessThan(3);
  });

  it("raises each galaxy with its melodic contour", () => {
    const t = new MelodyTracker();
    play(t, beat * 0.9);
    const low = t.lift[0];
    play(t, beat * 3.9, beat * 3);
    expect(t.lift[0]).toBeGreaterThan(low + 0.8);
    expect(t.lift[0]).toBeGreaterThan(0.6);
  });

  it("kicks the pair together on an upward leap and apart on a downward one", () => {
    const leaps: OrbitScore = {
      ...score,
      voices: [
        voice(
          [
            [0, beat, 60],
            [beat, beat * 2, 72],
            [beat * 2, beat * 3, 61],
          ],
          true,
        ),
      ],
    };
    const t = new MelodyTracker();
    const kicks: number[] = [];
    for (let tick = 0; tick < beat * 3; tick += (PPQ * 2) / 60) {
      const k = t.update(leaps, tick, true, 1 / 60);
      if (k) kicks.push(k);
    }
    expect(kicks).toEqual([1, -11 / 12]);
  });

  it("flashes the bridge when both voices strike a consonance together", () => {
    const t = new MelodyTracker();
    play(t, 10);
    // C4 over C2 together at the very start: an octave.
    expect(t.bridge).toBeGreaterThan(0.9);
    play(t, beat * 1.5, 10);
    expect(t.bridge).toBeLessThan(0.5);
  });

  it("starts notes again after a loop jumps back", () => {
    const t = new MelodyTracker();
    play(t, beat * 4);
    const before = t.onsets;
    play(t, beat * 0.5, 0);
    expect(t.onsets).toBe(before + 2);
  });
});
