import { describe, expect, it } from "vitest";
import {
  BinaryOrbit,
  CLOSEST_DISTANCE,
  HEAL_PLAYING,
  HEAL_RESTING,
  Kind,
  REST_DISTANCE,
  SILENCE,
  createGalaxies,
  diskBasis,
  duetSpecs,
  stepGalaxies,
  type Galaxies,
  type MusicState,
} from "./binary";

const playing = (over: Partial<MusicState> = {}): MusicState => ({
  playing: true,
  closeness: 0.5,
  energy: 0.5,
  rest: 0,
  liftA: 0,
  liftB: 0,
  ...over,
});
const distance = (a: number[], b: number[]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Stars of one galaxy farther than `limit` from their own core. */
function stripped(g: Galaxies, host: number, limit: number) {
  let n = 0,
    total = 0;
  for (let i = 0; i < g.count; i++) {
    if (g.host[i] !== host || g.kind[i] === Kind.Dust) continue;
    total++;
    const j = i * 3;
    if (Math.hypot(g.rel[j], g.rel[j + 1], g.rel[j + 2]) > limit) n++;
  }
  return n / total;
}

describe("binary orbit", () => {
  it("keeps the centre of mass still and the cores on opposite sides", () => {
    const orbit = new BinaryOrbit();
    for (let k = 0; k < 600; k++) {
      orbit.step(1 / 60, playing());
      const { coreA: a, coreB: b, massA, massB } = orbit;
      for (const axis of [0, 2])
        expect(a[axis] * massA + b[axis] * massB).toBeCloseTo(0, 6);
      expect(distance(a, b)).toBeCloseTo(
        Math.hypot(orbit.distance, a[1] - b[1]),
        6,
      );
    }
  });

  it("follows Kepler's third law: a pair twice as close turns 2^1.5 times faster", () => {
    const ratio =
      BinaryOrbit.angularSpeed(REST_DISTANCE / 2) /
      BinaryOrbit.angularSpeed(REST_DISTANCE);
    expect(ratio).toBeCloseTo(2 ** 1.5, 6);
  });

  it("draws the pair together as the music plays on, closer for unison and loud passages", () => {
    const quiet = new BinaryOrbit(),
      intense = new BinaryOrbit();
    const seconds: number[] = [];
    for (let k = 1; k <= 60 * 60; k++) {
      quiet.step(1 / 60, playing({ closeness: 0.1, energy: 0.1 }));
      intense.step(1 / 60, playing({ closeness: 1, energy: 1 }));
      if (k % (60 * 15) === 0) seconds.push(intense.distance);
    }
    // Steadily inward over a minute of music…
    for (let k = 1; k < seconds.length; k++)
      expect(seconds[k]).toBeLessThan(seconds[k - 1]);
    expect(intense.distance).toBeLessThan(1.7);
    expect(intense.distance).toBeGreaterThanOrEqual(CLOSEST_DISTANCE - 0.01);
    // …and further for close, loud voices than for distant, quiet ones.
    expect(intense.distance).toBeLessThan(quiet.distance - 0.15);
  });

  it("drifts back to the resting distance when the music stops", () => {
    const orbit = new BinaryOrbit();
    for (let k = 0; k < 60 * 60; k++)
      orbit.step(1 / 60, playing({ closeness: 1, energy: 1 }));
    expect(orbit.distance).toBeLessThan(1.7);
    for (let k = 0; k < 60 * 45; k++) orbit.step(1 / 60, SILENCE);
    expect(orbit.distance).toBeCloseTo(REST_DISTANCE, 1);
    expect(orbit.inspiral).toBeLessThan(0.02);
  });

  it("only a phrase that has ended lets the pair relax while playing", () => {
    const singing = new BinaryOrbit(),
      pausing = new BinaryOrbit();
    for (let k = 0; k < 60 * 20; k++) {
      singing.step(1 / 60, playing());
      pausing.step(1 / 60, playing({ rest: 1 }));
    }
    expect(singing.distance).toBeLessThan(pausing.distance);
  });
});

describe("galaxy stars", { timeout: 30_000 }, () => {
  const specs = duetSpecs(0.12);

  it("turn prograde with the orbit, which is what pulls out long tails", () => {
    for (const spec of specs) {
      const b = diskBasis(spec.normal);
      // Disk spin (sense × normal) shares the orbit's −y angular momentum.
      expect(b.sense * -b.n[1]).toBeGreaterThan(0);
      expect(Math.hypot(...b.e1)).toBeCloseTo(1, 6);
      expect(
        b.e1[0] * b.n[0] + b.e1[1] * b.n[1] + b.e1[2] * b.n[2],
      ).toBeCloseTo(0, 6);
    }
  });

  /** Share of a galaxy's stars beyond `factor` of its radius, and of its nucleus beyond a quarter. */
  const shape = (g: Galaxies, host: number) => {
    const R = specs[host].radius;
    return {
      torn: stripped(g, host, 1.3 * R),
      nucleus: (() => {
        let n = 0,
          out = 0;
        for (let i = 0; i < g.count; i++) {
          if (g.host[i] !== host || g.home[i * 3] > 0.1 * R) continue;
          n++;
          const j = i * 3;
          if (Math.hypot(g.rel[j], g.rel[j + 1], g.rel[j + 2]) > 0.25 * R)
            out++;
        }
        return out / n;
      })(),
    };
  };
  const run = (
    g: Galaxies,
    orbit: BinaryOrbit,
    clock: { t: number },
    seconds: number,
    music: MusicState,
  ) => {
    for (let k = 0; k < seconds * 30; k++) {
      clock.t += 1 / 30;
      orbit.step(1 / 30, music);
      stepGalaxies(
        g,
        specs,
        orbit,
        clock.t,
        1 / 30,
        music.playing ? HEAL_PLAYING : HEAL_RESTING,
      );
    }
  };

  it("stay in their disks while the pair rests apart", () => {
    const g = createGalaxies(specs),
      orbit = new BinaryOrbit(),
      clock = { t: 0 };
    run(g, orbit, clock, 60, SILENCE);
    for (const host of [0, 1]) expect(shape(g, host).torn).toBeLessThan(0.005);
  });

  it("are drawn out into bridges and tails by a close pass, nuclei intact", () => {
    const g = createGalaxies(specs),
      orbit = new BinaryOrbit(),
      clock = { t: 0 };
    run(g, orbit, clock, 90, playing({ closeness: 1, energy: 1 }));
    expect(orbit.distance).toBeLessThan(1.6);
    const a = shape(g, 0),
      b = shape(g, 1);
    // Measured: about a fifth of each disk is drawn beyond 1.3 radii…
    expect(a.torn).toBeGreaterThan(0.1);
    expect(b.torn).toBeGreaterThan(0.1);
    // …while most of each galaxy, and all of each nucleus, stays home.
    expect(a.torn).toBeLessThan(0.4);
    expect(b.torn).toBeLessThan(0.4);
    expect(a.nucleus).toBeLessThan(0.02);
    expect(b.nucleus).toBeLessThan(0.02);
  });

  it("heal back into calm spirals within half a minute of silence", () => {
    const g = createGalaxies(specs),
      orbit = new BinaryOrbit(),
      clock = { t: 0 };
    run(g, orbit, clock, 90, playing({ closeness: 1, energy: 1 }));
    run(g, orbit, clock, 30, SILENCE);
    for (const host of [0, 1]) expect(shape(g, host).torn).toBeLessThan(0.005);
    expect(orbit.distance).toBeGreaterThan(2.3);
  });

  it("place every star in the world around its own core", () => {
    const g = createGalaxies(specs),
      orbit = new BinaryOrbit();
    stepGalaxies(g, specs, orbit, 0, 1 / 60, 0);
    for (let i = 0; i < g.count; i += 97) {
      const core = g.host[i] ? orbit.coreB : orbit.coreA;
      for (let k = 0; k < 3; k++)
        expect(g.world[i * 3 + k]).toBeCloseTo(core[k] + g.rel[i * 3 + k], 5);
    }
  });
});
