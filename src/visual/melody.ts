/**
 * Turns the two voices' notes into moment-to-moment light and motion for the binary galaxies.
 *
 * - Every note onset sends a ripple of light out from its galaxy's nucleus through the arms.
 * - While a note is held, the arms glow at a radius set by its pitch: low notes in the inner
 *   disk, high notes far out on the arms. A melody that rises and falls moves light outward
 *   and inward along the spiral. Colour follows pitch too, from gold (low) to ice blue (high).
 * - The melodic contour lifts and lowers the galaxy; a leap nudges the pair together (up) or
 *   apart (down), so their distance breathes with the line.
 * - When both voices strike together on a consonant interval, the bridge between them flashes.
 *
 * Pure and DOM-free: the renderer reads `ripples`, `lights`, `bridge` and `lift`.
 */
import type { OrbitScore, OrbitVoice } from "./orbit";
import { PPQ } from "../domain/models";

export interface Ripple {
  /** 0 = the upper voice's (larger) galaxy, 1 = the lower voice's. */
  host: number;
  /** Seconds since the onset. */
  age: number;
  /** 0–1.5: louder for leaps. */
  strength: number;
  /** 0–1: pitch within the voice's range, for colour. */
  hue: number;
}

export interface Light {
  host: number;
  /** Radius that glows, in radii of its galaxy. */
  radius: number;
  /** 0–1, fading after the note ends. */
  strength: number;
  hue: number;
}

export const MAX_RIPPLES = 6;
/** Ripples travel outward at this many galaxy radii per second and fade with this half-life. */
export const RIPPLE_SPEED = 1.1;
export const RIPPLE_LIFE = 2.2;
/** Held notes light radii from INNER (lowest note) to OUTER (highest). */
const INNER = 0.22,
  OUTER = 1.0;
/** Intervals (mod 12) heard as consonant: unison, thirds, fourth, fifth, sixths. */
const CONSONANT = new Set([0, 3, 4, 5, 7, 8, 9]);

interface VoiceState {
  lastStart: number;
  lastPitch: number | null;
  onsetAt: number;
  light: Light | null;
  fading: Light | null;
  lift: number;
}

/** The note a voice is sounding at `tick` (highest for the upper voice, lowest for the lower). */
export function soundingNote(voice: OrbitVoice, tick: number) {
  let found: OrbitVoice["notes"][number] | null = null;
  for (let i = upperBound(voice, tick) - 1; i >= 0; i--) {
    const note = voice.notes[i];
    if (note.start <= tick - voice.longest) break;
    if (note.end <= tick) continue;
    if (
      !found ||
      (voice.upper ? note.pitch > found.pitch : note.pitch < found.pitch)
    )
      found = note;
  }
  return found;
}
function upperBound(voice: OrbitVoice, tick: number) {
  let lo = 0,
    hi = voice.notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (voice.notes[mid].start <= tick) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export class MelodyTracker {
  ripples: Ripple[] = [];
  lights: Light[] = [];
  /** 0–1: the bridge flash. */
  bridge = 0;
  /** −1 (low) to 1 (high): each galaxy's height from its melodic contour. */
  lift: [number, number] = [0, 0];
  /** Onsets seen so far (for tests and diagnostics). */
  onsets = 0;
  private voices: VoiceState[] = [0, 1].map(() => this.fresh());
  private lastTick = -1;
  private clock = 0;

  private fresh(): VoiceState {
    return {
      lastStart: -1,
      lastPitch: null,
      onsetAt: -Infinity,
      light: null,
      fading: null,
      lift: 0,
    };
  }

  /** Advances by `dt` seconds with the playhead at `tick`. Returns the leap kick for the orbit:
   * positive draws the pair together, negative pushes it apart. */
  update(score: OrbitScore, tick: number, playing: boolean, dt: number) {
    this.clock += dt;
    let kick = 0;
    // A jump backwards is a loop or a seek: notes may start again.
    if (!playing || tick < this.lastTick - PPQ / 8)
      for (const v of this.voices) {
        v.lastStart = -1;
        if (!playing) v.lastPitch = null;
      }
    this.lastTick = tick;
    const onsetHosts: number[] = [];
    score.voices.slice(0, 2).forEach((voice, host) => {
      const state = this.voices[host];
      const note = playing ? soundingNote(voice, tick) : null;
      const span = Math.max(1, voice.high - voice.low);
      if (note && note.start !== state.lastStart) {
        // An onset: ripple, move the held light, and kick on a leap.
        const hue = (note.pitch - voice.low) / span;
        const leap =
          state.lastPitch === null ? 0 : note.pitch - state.lastPitch;
        this.ripples.push({
          host,
          age: 0,
          strength: Math.min(1.5, 0.8 + Math.abs(leap) / 12),
          hue,
        });
        if (this.ripples.length > MAX_RIPPLES * 2) this.ripples.shift();
        if (state.light) state.fading = { ...state.light };
        state.light = {
          host,
          radius: INNER + (OUTER - INNER) * hue,
          strength: 1,
          hue,
        };
        if (Math.abs(leap) >= 5)
          kick += Math.sign(leap) * Math.min(1, Math.abs(leap) / 12);
        state.lastStart = note.start;
        state.lastPitch = note.pitch;
        state.onsetAt = this.clock;
        this.onsets++;
        onsetHosts.push(host);
      } else if (!note && state.light) {
        state.fading = { ...state.light };
        state.light = null;
      }
      const target = note ? ((note.pitch - voice.low) / span) * 2 - 1 : 0;
      state.lift += (target - state.lift) * (1 - Math.exp(-dt / 0.25));
      this.lift[host] = state.lift;
    });
    // Both voices together on a consonance: the bridge lights.
    const [a, b] = this.voices;
    if (
      onsetHosts.length &&
      Math.abs(a.onsetAt - b.onsetAt) < 0.09 &&
      a.lastPitch !== null &&
      b.lastPitch !== null &&
      CONSONANT.has(Math.abs(a.lastPitch - b.lastPitch) % 12)
    )
      this.bridge = 1;
    this.bridge *= Math.exp(-dt / 0.7);
    for (const r of this.ripples) r.age += dt;
    this.ripples = this.ripples.filter((r) => r.age < RIPPLE_LIFE);
    for (const v of this.voices) {
      if (v.fading) {
        v.fading.strength *= Math.exp(-dt / 0.35);
        if (v.fading.strength < 0.02) v.fading = null;
      }
    }
    this.lights = this.voices.flatMap((v) =>
      [v.light, v.fading].filter((l): l is Light => !!l),
    );
    return kick;
  }

  /** The newest ripples for the renderer, at most MAX_RIPPLES. */
  recentRipples() {
    return this.ripples.slice(-MAX_RIPPLES);
  }
}
