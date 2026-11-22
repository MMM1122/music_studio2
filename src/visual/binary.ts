/**
 * A musical binary galaxy system.
 *
 * Two galaxy cores orbit their common centre of mass. The music sets how far apart they are:
 * the longer and the stronger the duet plays, and the closer its two voices move in pitch, the
 * tighter the orbit. Orbital speed follows Kepler's third law (period ∝ separation^1.5), so a
 * close pair also swings round faster. Stars are test particles: each orbits its own galaxy
 * and feels the companion only through the tide (the difference between the companion's pull
 * on the star and on the star's own core). Close passes therefore draw out bridges and tails
 * by themselves. When the music stops, the cores drift back apart and every star eases back
 * to its place in a calm, rigidly turning spiral, so the system heals between takes.
 *
 * Units: lengths in radii of the larger galaxy, time in seconds. Everything here is
 * deterministic and free of the DOM, so it can be tested and rendered by any backend.
 */
import { random } from "./orbitArtwork";

export type Vec3 = [number, number, number];

/** Separation of the cores at rest, in radii of the larger galaxy. */
export const REST_DISTANCE = 2.65;
/** Closest approach the music can bring them to: the disks overlap at their edges, as in
 * the photographs of real pairs, without the cores plunging through each other. */
export const CLOSEST_DISTANCE = 1.35;
/** How far each core rises or sinks with its melody, in galaxy radii. */
export const LIFT = 0.2;
/** Orbital period at rest; shorter when closer, by Kepler's third law. */
export const REST_PERIOD = 150;

export interface MusicState {
  playing: boolean;
  /** 0–1: how close the two voices are in pitch right now (1 = unison). */
  closeness: number;
  /** 0–1: loudness of the mix. */
  energy: number;
  /** 0–1: 1 once a phrase has ended and both voices are silent. */
  rest: number;
  /** Small vertical lift for each core from its voice's register (−1 to 1). */
  liftA: number;
  liftB: number;
}

export const SILENCE: MusicState = {
  playing: false,
  closeness: 0,
  energy: 0,
  rest: 1,
  liftA: 0,
  liftB: 0,
};

/** The two cores on their shared orbit. Masses are relative; A is the larger galaxy. */
export class BinaryOrbit {
  readonly massA = 1;
  readonly massB = 0.62;
  distance = REST_DISTANCE;
  private speed = 0;
  /** Orbital angle, radians. Starts with the pair side by side across the view. */
  phase = 0.18;
  /** 0–1: how far the music has drawn the pair inward; grows while playing, fades at rest. */
  inspiral = 0;
  /** 0–1, smoothed: how much the system is healing toward its calm shape. */
  calm = 1;
  private liftA = 0;
  private liftB = 0;
  coreA: Vec3 = [0, 0, 0];
  coreB: Vec3 = [0, 0, 0];

  constructor() {
    this.place();
  }

  /** Where the music wants the cores to be. */
  static targetDistance(inspiral: number, music: MusicState) {
    if (!music.playing) return REST_DISTANCE;
    const moment =
      (music.closeness * 0.55 + music.energy * 0.45) * (1 - music.rest * 0.7);
    // A loud unison draws them in at once; staying power draws them in further.
    const reach = (1 - 0.8 * inspiral) * (1 - 0.5 * moment);
    return CLOSEST_DISTANCE + (REST_DISTANCE - CLOSEST_DISTANCE) * reach;
  }

  /** Angular speed at a separation, by Kepler's third law. */
  static angularSpeed(distance: number) {
    return ((Math.PI * 2) / REST_PERIOD) * (REST_DISTANCE / distance) ** 1.5;
  }

  /** A melodic leap nudges the pair: positive draws them together, negative apart. */
  kick(amount: number) {
    this.speed -= amount * 0.45;
  }

  step(dt: number, music: MusicState) {
    const drawing = music.playing && music.rest < 0.8;
    // Inspiral builds over about half a minute of music and unwinds in about ten seconds.
    this.inspiral += drawing
      ? ((1 - this.inspiral) * dt) / 30
      : (-this.inspiral * dt) / 10;
    this.calm +=
      ((music.playing ? 0 : 1) - this.calm) * (1 - Math.exp(-dt / 1.5));
    // Critically damped approach, so the cores glide rather than jump with each note.
    const target = BinaryOrbit.targetDistance(this.inspiral, music);
    const omega = 1.3;
    const acceleration =
      omega * omega * (target - this.distance) - 2 * omega * this.speed;
    this.speed += acceleration * dt;
    this.distance += this.speed * dt;
    this.phase += BinaryOrbit.angularSpeed(this.distance) * dt;
    const follow = 1 - Math.exp(-dt / 0.3);
    this.liftA += (music.liftA - this.liftA) * follow;
    this.liftB += (music.liftB - this.liftB) * follow;
    this.place();
  }

  private place() {
    const total = this.massA + this.massB;
    const c = Math.cos(this.phase),
      s = Math.sin(this.phase);
    // The orbit lies in the world x–z plane around the centre of mass at the origin.
    const ra = (this.distance * this.massB) / total,
      rb = (this.distance * this.massA) / total;
    this.coreA = [-ra * c, LIFT * this.liftA, -ra * s];
    this.coreB = [rb * c, LIFT * this.liftB, rb * s];
  }
}

/** How each galaxy looks and moves. */
export interface GalaxySpec {
  seed: number;
  /** Disk radius in units of the larger galaxy's radius. */
  radius: number;
  /** Circular speed scale and core radius of the host's (logarithmic) potential. */
  speed: number;
  coreRadius: number;
  /** A compact bulge (G·M and scale radius) binds the nucleus far more tightly than the disk. */
  bulgeMass: number;
  bulgeRadius: number;
  /** Disk normal and in-plane axis, in world coordinates (unit vectors). */
  normal: Vec3;
  /** Spiral arm count and pitch angle (degrees). */
  arms: number;
  pitch: number;
  /** Star counts by population. */
  bulge: number;
  disk: number;
  young: number;
  /** Bright star clusters, in small groups. */
  knots: number;
  hii: number;
  glow: number;
  dust: number;
  /** 0–1: share of warm light in the outer disk (the small galaxy is a little warmer). */
  warmth: number;
}

/** Particle populations, also used by renderers to choose a sprite. */
export const enum Kind {
  Star = 0,
  Knot = 1,
  Glow = 2,
  Dust = 3,
}

export interface Galaxies {
  count: number;
  /** Position relative to the host core and velocity, 3 floats per star (world axes). */
  rel: Float32Array;
  vel: Float32Array;
  /** World position for rendering, 3 floats per star. */
  world: Float32Array;
  /** Calm-state polar coordinates in the host disk: radius, angle, height. */
  home: Float32Array;
  host: Uint8Array;
  kind: Uint8Array;
  /** Linear RGB and intensity, 4 floats per star. */
  color: Float32Array;
  /** Sprite size in units of the larger galaxy's radius. */
  size: Float32Array;
  /** Circular speed at each star's calm radius (fixed, so computed once). */
  calmSpeed: Float32Array;
  /** Steps taken; healing visits a quarter of the stars on each step, in turn. */
  steps: number;
  /** Scratch space for the companion's pull on each star. */
  pull?: Float32Array;
}

function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Orthonormal disk basis; the rotation sense is chosen to be prograde with the binary orbit,
 * which is what pulls out long tails in real encounters. */
export function diskBasis(normal: Vec3) {
  const n = normalize(normal);
  const helper: Vec3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const e1 = normalize(cross(helper, n));
  const e2 = cross(n, e1);
  // The binary orbit's angular momentum points along −y (see BinaryOrbit.place).
  const sense = n[1] < 0 ? 1 : -1;
  return { n, e1, e2, sense };
}

/** Inward pull per unit radius at radius r: logarithmic halo plus a Plummer bulge. */
export function binding(spec: GalaxySpec, r2: number) {
  const b2 = r2 + spec.bulgeRadius * spec.bulgeRadius;
  return (
    (spec.speed * spec.speed) / (r2 + spec.coreRadius * spec.coreRadius) +
    spec.bulgeMass / (b2 * Math.sqrt(b2))
  );
}

/** Circular speed at radius r in the host galaxy. */
export const circularSpeed = (spec: GalaxySpec, r: number) =>
  r * Math.sqrt(binding(spec, r * r));

/** Pattern speed of the calm spiral: the disk turns as one, so the arms never wind up. */
export const patternSpeed = (spec: GalaxySpec) =>
  circularSpeed(spec, spec.radius * 0.55) / (spec.radius * 0.55);

const gaussian = (rand: () => number) => rand() + rand() + rand() + rand() - 2;

/** Builds both galaxies' stars, already at their calm positions for time 0. */
export function createGalaxies(specs: [GalaxySpec, GalaxySpec]): Galaxies {
  const total = specs.reduce(
    (sum, s) =>
      sum + s.bulge + s.disk + s.young + s.knots + s.hii + s.glow + s.dust,
    0,
  );
  const g: Galaxies = {
    count: total,
    rel: new Float32Array(total * 3),
    vel: new Float32Array(total * 3),
    world: new Float32Array(total * 3),
    home: new Float32Array(total * 3),
    host: new Uint8Array(total),
    kind: new Uint8Array(total),
    color: new Float32Array(total * 4),
    size: new Float32Array(total),
    calmSpeed: new Float32Array(total),
    steps: 0,
  };
  let i = 0;
  specs.forEach((spec, hostIndex) => {
    const rand = random(spec.seed);
    const R = spec.radius;
    const sense = diskBasis(spec.normal).sense;
    /** Angle of an arm at radius r: a trailing logarithmic spiral. */
    const armAngle = (arm: number, r: number) =>
      (arm * Math.PI * 2) / spec.arms -
      (sense * Math.log(Math.max(0.04, r / R) / 0.2)) /
        Math.tan((spec.pitch * Math.PI) / 180);
    const add = (
      kind: Kind,
      r: number,
      angle: number,
      z: number,
      rgb: [number, number, number],
      intensity: number,
      size: number,
    ) => {
      g.home[i * 3] = r;
      g.home[i * 3 + 1] = angle;
      g.home[i * 3 + 2] = z;
      g.host[i] = hostIndex;
      g.kind[i] = kind;
      g.color.set([rgb[0], rgb[1], rgb[2], intensity], i * 4);
      g.size[i] = size;
      i++;
    };
    /** A radius along the arms with an exponential fall-off, clamped to the disk. */
    const armRadius = (scale: number, inner: number) =>
      Math.min(R * 1.15, inner * R - Math.log(1 - rand() * 0.98) * scale * R);
    // Old stars of the bulge: a warm, dense nucleus.
    for (let k = 0; k < spec.bulge; k++) {
      const r = Math.abs(gaussian(rand)) * 0.1 * R + rand() * 0.02 * R;
      const warm = 0.82 + rand() * 0.18;
      add(
        Kind.Star,
        r,
        rand() * Math.PI * 2,
        gaussian(rand) * 0.035 * R,
        [1, 0.72 * warm + 0.06, 0.42 * warm],
        0.45 + rand() * 0.6,
        0.007 + rand() ** 3 * 0.014,
      );
    }
    /** Feathering: arms shed spurs every so often, so they read as filaments, not ropes. */
    const feather = (arm: number, r: number) => {
      const phase = (r / R) * 11 + arm * 1.7;
      const saw = phase - Math.floor(phase);
      return sense * saw * saw * 0.38;
    };
    // The disk: soft older light that fills the arms and the spaces between them.
    for (let k = 0; k < spec.disk; k++) {
      const r = armRadius(0.36, 0.04);
      const onArm = rand() < 0.7;
      const arm = k % spec.arms;
      const angle = onArm
        ? armAngle(arm, r) +
          feather(arm, r) +
          gaussian(rand) * (0.22 + 0.12 * (r / R))
        : rand() * Math.PI * 2;
      const outer = Math.min(1, r / R);
      const warm = rand() < spec.warmth + 0.75 * (1 - outer) ** 1.5;
      add(
        Kind.Star,
        r,
        angle,
        gaussian(rand) * 0.02 * R,
        warm ? [1, 0.8, 0.58] : [0.68, 0.8, 1],
        0.16 + rand() ** 2 * 0.34,
        0.009 + rand() * 0.012,
      );
    }
    // Young blue stars strung along feathered arms.
    for (let k = 0; k < spec.young; k++) {
      const r = armRadius(0.32, 0.2);
      const arm = k % spec.arms;
      const angle =
        armAngle(arm, r) +
        feather(arm, r) +
        gaussian(rand) * (0.06 + 0.05 * (r / R));
      add(
        Kind.Star,
        r * (1 + gaussian(rand) * 0.025),
        angle,
        gaussian(rand) * 0.012 * R,
        rand() < 0.75 ? [0.38, 0.6, 1] : [0.62, 0.8, 1],
        0.4 + rand() ** 2 * 0.8,
        0.006 + rand() * 0.005,
      );
    }
    // Bright clusters, in small groups along the arms.
    for (let k = 0; k < spec.knots; ) {
      const r = armRadius(0.3, 0.24);
      const arm = k % spec.arms;
      const centre = armAngle(arm, r) + feather(arm, r) + gaussian(rand) * 0.05;
      const group = 2 + Math.floor(rand() * 5);
      for (let m = 0; m < group && k < spec.knots; m++, k++) {
        const bright = rand() ** 2;
        add(
          Kind.Knot,
          r + gaussian(rand) * 0.02 * R,
          centre + gaussian(rand) * 0.035,
          gaussian(rand) * 0.008 * R,
          bright > 0.5 ? [0.78, 0.88, 1] : [0.5, 0.7, 1],
          0.5 + bright * 1.5,
          0.009 + bright * 0.016,
        );
      }
    }
    // Pink nebulae where stars are forming, sitting just outside the dust lanes.
    for (let k = 0; k < spec.hii; k++) {
      const r = armRadius(0.25, 0.22);
      const arm = k % spec.arms;
      add(
        Kind.Knot,
        r,
        armAngle(arm, r) + feather(arm, r) + gaussian(rand) * 0.05,
        0,
        [1, 0.38, 0.62],
        0.45 + rand() * 0.7,
        0.008 + rand() * 0.01,
      );
    }
    // Diffuse light: gold over the inner disk, violet-brown farther out, blue at the rim.
    for (let k = 0; k < spec.glow; k++) {
      const r = armRadius(0.34, 0.03);
      const outer = Math.min(1, r / R);
      const arm = k % spec.arms;
      // Gold over the nucleus, a dusky violet-brown through the inner disk, blue outside.
      const tint: [number, number, number] =
        outer < 0.3
          ? [1, 0.7, 0.42]
          : outer < 0.55
            ? [0.62, 0.4, 0.46]
            : [0.32, 0.52, 1];
      add(
        Kind.Glow,
        r,
        armAngle(arm, r) +
          feather(arm, r) +
          gaussian(rand) * (0.16 + 0.2 * (1 - outer)),
        0,
        tint,
        (outer < 0.3 ? 0.05 : outer < 0.55 ? 0.03 : 0.045) + rand() * 0.035,
        0.06 + rand() * 0.07 + 0.05 * outer,
      );
    }
    // Dust lanes along the inner (concave) edge of each arm: continuous, soft-edged, and
    // absorbing blue first so they read as brown against the golden inner disk.
    for (let k = 0; k < spec.dust; k++) {
      const r = armRadius(0.3, 0.16);
      const arm = k % spec.arms;
      const lane = rand() < 0.7 ? 0.1 : 0.22;
      add(
        Kind.Dust,
        r,
        armAngle(arm, r) +
          sense * lane +
          0.04 * Math.sin((r / R) * 23 + arm) +
          gaussian(rand) * 0.07,
        0,
        [0.2, 0.34, 0.5],
        0.12 + rand() * 0.18,
        0.03 + rand() * 0.035,
      );
    }
  });
  for (let k = 0; k < total; k++)
    g.calmSpeed[k] = circularSpeed(specs[g.host[k]], g.home[k * 3]);
  resetToCalm(g, specs, 0);
  return g;
}

/** Calm position and circular velocity of one star at time `t`, relative to its core. */
function calmState(
  g: Galaxies,
  specs: [GalaxySpec, GalaxySpec],
  bases: ReturnType<typeof diskBasis>[],
  i: number,
  t: number,
  out: Float32Array,
) {
  const spec = specs[g.host[i]],
    b = bases[g.host[i]];
  const r = g.home[i * 3],
    z = g.home[i * 3 + 2];
  const angle = g.home[i * 3 + 1] + b.sense * patternSpeed(spec) * t;
  const c = Math.cos(angle),
    s = Math.sin(angle);
  const v = circularSpeed(spec, r) * b.sense;
  for (let k = 0; k < 3; k++) {
    out[k] = r * (c * b.e1[k] + s * b.e2[k]) + z * b.n[k];
    out[3 + k] = v * (-s * b.e1[k] + c * b.e2[k]);
  }
}

export function resetToCalm(
  g: Galaxies,
  specs: [GalaxySpec, GalaxySpec],
  t: number,
) {
  const bases = specs.map((s) => diskBasis(s.normal));
  const state = new Float32Array(6);
  for (let i = 0; i < g.count; i++) {
    calmState(g, specs, bases, i, t, state);
    g.rel.set(state.subarray(0, 3), i * 3);
    g.vel.set(state.subarray(3, 6), i * 3);
  }
}

/** Strength of each galaxy's pull on the other's stars, relative to the hosts' own. Tuned
 * so a close pass pulls out about a tenth of the larger disk and a third of the smaller one,
 * while both nuclei stay whole. */
const TIDE = 4;
/** Softening of that pull, in units of the companion's core radius. */
const SOFTENING = 0.5;
/** Healing rate (per second) while music plays: tails persist for tens of seconds. */
export const HEAL_PLAYING = 0.18;
/** Healing rate at rest: the calm spirals return within a few seconds. */
export const HEAL_RESTING = 0.6;

/** Advances every star by `dt` seconds under its own galaxy's pull and the companion's tide,
 * then eases it toward its calm position by `heal` (per second). Writes world positions. */
export function stepGalaxies(
  g: Galaxies,
  specs: [GalaxySpec, GalaxySpec],
  orbit: BinaryOrbit,
  t: number,
  dt: number,
  heal: number,
) {
  const bases = specs.map((s) => diskBasis(s.normal));
  const cores = [orbit.coreA, orbit.coreB];
  const masses = [orbit.massA, orbit.massB];
  // Healing is gentle, so each step heals a quarter of the stars by four steps' worth.
  const HEAL_STRIDE = 4;
  const blend = 1 - Math.exp(-heal * dt * HEAL_STRIDE);
  const healPhase = g.steps++ % HEAL_STRIDE;
  if (!g.pull || g.pull.length !== g.count * 3)
    g.pull = new Float32Array(g.count * 3);
  const pull = g.pull;
  for (let host = 0; host < 2; host++) {
    const spec = specs[host],
      other = 1 - host;
    const D = [
      cores[other][0] - cores[host][0],
      cores[other][1] - cores[host][1],
      cores[other][2] - cores[host][2],
    ];
    const gm = TIDE * specs[0].speed ** 2 * (masses[other] / masses[0]);
    const pattern = patternSpeed(spec);
    // A galaxy's mass is spread out, so its pull is softened over its core radius.
    const soft = SOFTENING * specs[other].coreRadius;
    // The core falls freely in the companion's field, so each star feels only the tide:
    // the companion's pull on the star minus its pull on the core. The nucleus, where that
    // difference vanishes, stays put however close the companion comes.
    const dd = D[0] * D[0] + D[1] * D[1] + D[2] * D[2] + soft * soft;
    const coreK = gm / (dd * Math.sqrt(dd));
    const mx = coreK * D[0],
      my = coreK * D[1],
      mz = coreK * D[2];
    for (let i = 0; i < g.count; i++) {
      if (g.host[i] !== host) continue;
      const j = i * 3;
      const sx = g.rel[j] - D[0],
        sy = g.rel[j + 1] - D[1],
        sz = g.rel[j + 2] - D[2];
      const s2 = sx * sx + sy * sy + sz * sz + soft * soft;
      const k = -gm / (s2 * Math.sqrt(s2));
      pull[j] = k * sx;
      pull[j + 1] = k * sy;
      pull[j + 2] = k * sz;
    }
    for (let i = 0; i < g.count; i++) {
      if (g.host[i] !== host) continue;
      const j = i * 3;
      let x = g.rel[j],
        y = g.rel[j + 1],
        z = g.rel[j + 2];
      // Own galaxy: a bulge-bound nucleus inside a nearly solid-body disk.
      const own = -binding(spec, x * x + y * y + z * z);
      let vx = g.vel[j] + (own * x + pull[j] - mx) * dt,
        vy = g.vel[j + 1] + (own * y + pull[j + 1] - my) * dt,
        vz = g.vel[j + 2] + (own * z + pull[j + 2] - mz) * dt;
      x += vx * dt;
      y += vy * dt;
      z += vz * dt;
      if (blend > 0 && i % HEAL_STRIDE === healPhase) {
        // Heal in the disk's own polar coordinates. Blending straight toward the calm
        // position would cut across the circle and, frame after frame, drag stars inward.
        const { e1, e2, n: nn, sense } = bases[host];
        const a1 = x * e1[0] + y * e1[1] + z * e1[2],
          a2 = x * e2[0] + y * e2[1] + z * e2[2],
          h = x * nn[0] + y * nn[1] + z * nn[2];
        const rho = Math.hypot(a1, a2),
          theta = Math.atan2(a2, a1);
        const c = Math.cos(theta),
          s = Math.sin(theta);
        const u1 = vx * e1[0] + vy * e1[1] + vz * e1[2],
          u2 = vx * e2[0] + vy * e2[1] + vz * e2[2],
          uh = vx * nn[0] + vy * nn[1] + vz * nn[2];
        let vr = u1 * c + u2 * s,
          vt = -u1 * s + u2 * c,
          vh = uh;
        const calmRho = g.home[j],
          calmTheta = g.home[j + 1] + sense * pattern * t,
          calmH = g.home[j + 2];
        let turn = (calmTheta - theta) % (Math.PI * 2);
        if (turn > Math.PI) turn -= Math.PI * 2;
        else if (turn < -Math.PI) turn += Math.PI * 2;
        const rho2 = rho + (calmRho - rho) * blend,
          theta2 = theta + turn * blend,
          h2 = h + (calmH - h) * blend;
        vr -= vr * blend;
        vt += (sense * g.calmSpeed[i] - vt) * blend;
        vh -= vh * blend;
        const c2 = Math.cos(theta2),
          s2 = Math.sin(theta2);
        x = rho2 * (c2 * e1[0] + s2 * e2[0]) + h2 * nn[0];
        y = rho2 * (c2 * e1[1] + s2 * e2[1]) + h2 * nn[1];
        z = rho2 * (c2 * e1[2] + s2 * e2[2]) + h2 * nn[2];
        const r1 = vr * c2 - vt * s2,
          r2 = vr * s2 + vt * c2;
        vx = r1 * e1[0] + r2 * e2[0] + vh * nn[0];
        vy = r1 * e1[1] + r2 * e2[1] + vh * nn[1];
        vz = r1 * e1[2] + r2 * e2[2] + vh * nn[2];
      }
      g.rel[j] = x;
      g.rel[j + 1] = y;
      g.rel[j + 2] = z;
      g.vel[j] = vx;
      g.vel[j + 1] = vy;
      g.vel[j + 2] = vz;
      g.world[j] = cores[host][0] + x;
      g.world[j + 1] = cores[host][1] + y;
      g.world[j + 2] = cores[host][2] + z;
    }
  }
}

/** The pair as it appears in Studio: a nearly face-on grand-design spiral and a smaller
 * companion seen at about 50°, both turning with the orbit. Counts scale with `detail`. */
export function duetSpecs(detail = 1): [GalaxySpec, GalaxySpec] {
  const n = (count: number) => Math.round(count * detail);
  return [
    {
      seed: 7,
      radius: 1,
      speed: 0.16,
      coreRadius: 0.75,
      bulgeMass: 0.0022,
      bulgeRadius: 0.1,
      normal: [0.2, -0.55, 0.81],
      arms: 2,
      pitch: 17,
      bulge: n(3200),
      disk: n(9000),
      young: n(9000),
      knots: n(900),
      hii: n(280),
      glow: n(2400),
      dust: n(3400),
      warmth: 0.1,
    },
    {
      seed: 23,
      radius: 0.68,
      speed: 0.16 * Math.sqrt(0.62),
      coreRadius: 0.5,
      bulgeMass: 0.0022 * 0.62,
      bulgeRadius: 0.07,
      normal: [-0.62, -0.68, 0.39],
      arms: 2,
      pitch: 21,
      bulge: n(2000),
      disk: n(5400),
      young: n(5200),
      knots: n(520),
      hii: n(160),
      glow: n(1400),
      dust: n(2000),
      warmth: 0.28,
    },
  ];
}

/** Camera zoom: leans in as the pair closes, so the encounter fills the frame. */
export function zoomFor(distance: number) {
  return Math.min(1.45, Math.max(1, (REST_DISTANCE + 1.9) / (distance + 1.9)));
}

/** Moves every star with its core without advancing the simulation, for frames drawn
 * between physics steps. */
export function placeStars(g: Galaxies, orbit: BinaryOrbit) {
  const cores = [orbit.coreA, orbit.coreB];
  for (let i = 0; i < g.count; i++) {
    const core = cores[g.host[i]],
      j = i * 3;
    g.world[j] = core[0] + g.rel[j];
    g.world[j + 1] = core[1] + g.rel[j + 1];
    g.world[j + 2] = core[2] + g.rel[j + 2];
  }
}
