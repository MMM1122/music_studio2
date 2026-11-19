import { PPQ, type Project } from "../domain/models";
import {
  collectEvents,
  isTrackAudible,
  type NoteEvent,
  type ReferenceMode,
} from "../audio/scheduler";

/** One melodic line the scene follows: a track's notes, flattened onto the song timeline. */
export interface OrbitVoice {
  trackId: string;
  name: string;
  /** Sorted by start tick. */
  notes: { start: number; end: number; pitch: number }[];
  /** Longest note, so a lookup only scans notes that could still be sounding. */
  longest: number;
  low: number;
  high: number;
  /** The upper voice follows its highest sounding note, the lower voice its lowest. */
  upper: boolean;
}
export interface OrbitScore {
  voices: OrbitVoice[];
  /** Interval range between the two voices across the song, in semitones. */
  closest: number;
  widest: number;
}

/** Picks the two most melodic audible MIDI tracks: many distinct onsets and pitches. */
export function chooseVoices(
  project: Project,
  mode: ReferenceMode = "both",
): OrbitScore {
  const byTrack = new Map<string, NoteEvent[]>();
  for (const event of collectEvents(project)) {
    if (event.type !== "note") continue;
    const track = project.tracks.find((t) => t.id === event.trackId);
    if (!track || track.type !== "midi" || track.role === "reference") continue;
    if (!isTrackAudible(project, track.id, mode)) continue;
    const list = byTrack.get(track.id) ?? [];
    list.push(event);
    byTrack.set(track.id, list);
  }
  const stats = [...byTrack.entries()].map(([trackId, events]) => {
    const onsets = new Set(events.map((e) => e.startTick)).size,
      pitches = new Set(events.map((e) => e.pitch)).size,
      mean = events.reduce((sum, e) => sum + e.pitch, 0) / events.length;
    return {
      trackId,
      events,
      mean,
      // Lines are mostly one note at a time and actually move.
      line: onsets / events.length >= 0.75 && onsets >= 4 && pitches >= 3,
      score: onsets + pitches * 4,
    };
  });
  // Outer voices first: the highest line against the lowest one, like a melody and its bass.
  const lines = stats.filter((s) => s.line).sort((a, b) => b.mean - a.mean);
  const picked =
    lines.length >= 2 ? [lines[0], lines[lines.length - 1]] : lines.slice();
  for (const s of [...stats].sort((a, b) => b.score - a.score))
    if (picked.length < 2 && !picked.includes(s)) picked.push(s);
  const ranked = picked.sort((a, b) => b.mean - a.mean);
  const voices = ranked.map(({ trackId, events }, index): OrbitVoice => {
    const notes = events
      .map((e) => ({
        start: e.startTick,
        end: e.startTick + e.durationTicks,
        pitch: e.pitch,
      }))
      .sort((a, b) => a.start - b.start);
    const pitches = notes.map((n) => n.pitch);
    return {
      trackId,
      name: project.tracks.find((t) => t.id === trackId)?.name ?? "",
      notes,
      longest: Math.max(0, ...notes.map((n) => n.end - n.start)),
      low: Math.min(...pitches),
      high: Math.max(...pitches),
      upper: index === 0,
    };
  });
  let closest = 0,
    widest = 12;
  if (voices.length === 2) {
    // Sample the interval on a sixteenth grid wherever both voices sound.
    const intervals: number[] = [];
    const end = Math.max(...voices.map((v) => v.notes.at(-1)?.end ?? 0));
    for (let tick = 0; tick < end; tick += PPQ / 4) {
      const a = pitchAt(voices[0], tick),
        b = pitchAt(voices[1], tick);
      if (a !== null && b !== null) intervals.push(Math.abs(a - b));
    }
    if (intervals.length) {
      closest = Math.min(...intervals);
      widest = Math.max(closest + 3, ...intervals);
    }
  }
  return { voices, closest, widest };
}

/** The voice's sounding pitch at `tick`, or null in a rest. */
export function pitchAt(voice: OrbitVoice, tick: number): number | null {
  const notes = voice.notes;
  let lo = 0,
    hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid].start <= tick) lo = mid + 1;
    else hi = mid;
  }
  let pitch: number | null = null;
  for (let i = lo - 1; i >= 0 && notes[i].start > tick - voice.longest; i--) {
    const note = notes[i];
    if (note.end <= tick) continue;
    if (
      pitch === null ||
      (voice.upper ? note.pitch > pitch : note.pitch < pitch)
    )
      pitch = note.pitch;
  }
  return pitch;
}

/** Most recent pitch at or before `tick` and how long ago that note ended (0 while sounding). */
export function recentPitch(
  voice: OrbitVoice,
  tick: number,
): { pitch: number | null; silentTicks: number } {
  const sounding = pitchAt(voice, tick);
  if (sounding !== null) return { pitch: sounding, silentTicks: 0 };
  let lastEnd = -Infinity,
    pitch: number | null = null;
  for (const note of voice.notes) {
    if (note.start > tick) break;
    if (note.end >= lastEnd) {
      lastEnd = note.end;
      pitch = note.pitch;
    }
  }
  return { pitch, silentTicks: pitch === null ? Infinity : tick - lastEnd };
}

/** Normalized scene positions (0–1 of width and height). */
export interface OrbitTargets {
  a: { x: number; y: number };
  b: { x: number; y: number };
  /** 0 while both voices play, 1 once a phrase has ended and both have settled into rest. */
  rest: number;
  separation: number;
}
/** Quiet distance the planets return to between phrases. */
export const REST_SEPARATION = 0.42;
const CLOSEST = 0.13,
  WIDEST = 0.56;
const smooth = (t: number) => t * t * (3 - 2 * t);
/** A rest shorter than half a beat is breath inside a phrase; after two beats the phrase is over. */
export function restAmount(silentTicks: number): number {
  return smooth(
    Math.max(0, Math.min(1, (silentTicks - PPQ / 2) / (PPQ * 1.5))),
  );
}

/** Where each planet should drift toward: height from its own melody, distance from the interval. */
export function orbitTargets(
  score: OrbitScore,
  tick: number,
  playing: boolean,
): OrbitTargets {
  const [upper, lower] = score.voices;
  const a = upper ? recentPitch(upper, tick) : null,
    b = lower ? recentPitch(lower, tick) : null;
  const restA = playing && a ? restAmount(a.silentTicks) : 1,
    restB = playing && b ? restAmount(b.silentTicks) : 1;
  const rest = (restA + restB) / 2;
  let pitchSeparation = REST_SEPARATION;
  if (a?.pitch != null && b?.pitch != null) {
    const span = Math.max(1, score.widest - score.closest);
    const t = Math.max(
      0,
      Math.min(1, (Math.abs(a.pitch - b.pitch) - score.closest) / span),
    );
    pitchSeparation = CLOSEST + (WIDEST - CLOSEST) * t;
  }
  const separation =
    pitchSeparation + (REST_SEPARATION - pitchSeparation) * rest;
  const height = (voice: OrbitVoice | undefined, pitch: number | null) => {
    if (!voice || pitch === null) return 0.5;
    const span = Math.max(1, voice.high - voice.low);
    // Higher notes rise; each line uses its own range so both contours stay readable.
    return 0.74 - ((pitch - voice.low) / span) * 0.48;
  };
  const yA = height(upper, a?.pitch ?? null),
    yB = height(lower, b?.pitch ?? null);
  const centre = 0.52;
  return {
    a: {
      x: centre - separation / 2,
      y: yA + (0.53 - yA) * restA,
    },
    b: {
      x: centre + separation / 2,
      y: yB + (0.44 - yB) * restB,
    },
    rest,
    separation,
  };
}

/** Damped spring toward a moving target: slightly under-damped, so motion carries and settles. */
export function springStep(
  position: number,
  velocity: number,
  target: number,
  dt: number,
  stiffness = 2.4,
  damping = 2.7,
): [number, number] {
  const acceleration = stiffness * (target - position) - damping * velocity;
  const v = velocity + acceleration * dt;
  return [position + v * dt, v];
}
