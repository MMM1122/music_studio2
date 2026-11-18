import { BAR, PPQ, type MidiNote, type Project, type Track } from "./models";
import { createMidiClip, createNote, createPattern } from "./factories";

/** A note as it was played: song positions in ticks, straight from the transport. */
export interface TakeNote {
  pitch: number;
  startTick: number;
  endTick: number;
  velocity: number;
}
export interface TakeOptions {
  /** Grid for note starts, in ticks. 0 keeps the timing exactly as played. */
  quantize?: number;
}
export interface TakeResult {
  /** The clip that received the first note, so the interface can select it. */
  clipId: string | null;
  added: number;
  /** Notes that had nowhere to go (see `applyTake`). Reported, never silently lost. */
  dropped: number;
}
export const RECORD_QUANTIZE = PPQ / 4;
const MIN_NOTE = 30;
const DRUM_NOTE = 100;

const snap = (tick: number, grid: number) =>
  grid > 0 ? Math.round(tick / grid) * grid : Math.round(tick);

/** Writes a played take into a track of `project` (mutating it, like the other commands).
 *
 * Notes that start inside an existing clip are overdubbed into that clip's pattern, wrapped
 * to the pattern's length when the clip loops, so recording over a loop layers onto it.
 * Notes played where the track is empty go into one new clip that starts on the bar line
 * before the first of them and ends on the bar line after the last, shortened if needed so
 * it never overlaps a clip that follows. */
export function applyTake(
  project: Project,
  trackId: string,
  played: TakeNote[],
  options: TakeOptions = {},
): TakeResult {
  const track = project.tracks.find((item) => item.id === trackId);
  if (!track || track.type === "audio" || played.length === 0)
    return { clipId: null, added: 0, dropped: 0 };
  const grid = options.quantize ?? RECORD_QUANTIZE;
  const drums = track.type === "drums";
  const notes = played
    .filter(
      (note) =>
        Number.isFinite(note.startTick) &&
        Number.isFinite(note.endTick) &&
        note.pitch >= 0 &&
        note.pitch <= 127,
    )
    .map((note) => {
      const start = Math.max(0, snap(note.startTick, grid));
      // Quantizing moves the start; the length the player held is kept.
      const length = drums
        ? DRUM_NOTE
        : Math.max(MIN_NOTE, Math.round(note.endTick - note.startTick));
      return { pitch: note.pitch, start, length, velocity: note.velocity };
    })
    .sort((a, b) => a.start - b.start);

  let firstClip: string | null = null;
  let added = 0;
  const loose: typeof notes = [];
  for (const note of notes) {
    const clip = clipAt(project, track, note.start);
    if (!clip) {
      loose.push(note);
      continue;
    }
    const pattern = project.patterns[clip.patternId];
    let local = note.start - clip.startTick;
    if (clip.loop) local %= pattern.lengthTicks;
    const length = Math.min(note.length, pattern.lengthTicks - local);
    if (length < 1) continue;
    if (hasNote(pattern.notes, note.pitch, local)) continue;
    pattern.notes.push(createNote(note.pitch, local, length, note.velocity));
    firstClip ??= clip.id;
    added++;
  }

  // Loose notes can sit on either side of existing clips, so they are gathered into one new
  // clip per empty stretch of the track.
  let dropped = 0;
  let rest = loose;
  while (rest.length) {
    const first = rest[0].start;
    const before = Math.max(
      0,
      ...track.clips
        .filter((clip) => clip.startTick <= first)
        .map((clip) => clip.startTick + clip.durationTicks),
    );
    const start = Math.max(Math.floor(first / BAR) * BAR, before);
    const next = Math.min(
      ...track.clips
        .filter((clip) => clip.startTick > first)
        .map((clip) => clip.startTick),
    );
    const limit = Number.isFinite(next) ? next : Infinity;
    const group = rest.filter((note) => note.start < limit);
    rest = rest.filter((note) => note.start >= limit);
    if (start > first) {
      // The gap is the unused tail of a clip whose pattern other clips share; it cannot be
      // lengthened without changing them, so these notes have nowhere to go.
      dropped += group.length;
      continue;
    }
    const last = Math.max(...group.map((note) => note.start + note.length));
    const end = Math.min(
      Math.max(start + PPQ, Math.ceil(last / BAR) * BAR),
      limit,
    );
    const pattern = createPattern(drums ? "drums" : "midi", end - start);
    pattern.name = "Recorded take";
    for (const note of group) {
      const local = note.start - start;
      const length = Math.min(note.length, pattern.lengthTicks - local);
      if (length < 1 || hasNote(pattern.notes, note.pitch, local)) continue;
      pattern.notes.push(createNote(note.pitch, local, length, note.velocity));
      added++;
    }
    if (pattern.notes.length) {
      const clip = createMidiClip(pattern, start);
      clip.loop = false;
      project.patterns[pattern.id] = pattern;
      track.clips.push(clip);
      firstClip ??= clip.id;
    }
  }
  return { clipId: firstClip, added, dropped };
}

function clipAt(project: Project, track: Track, tick: number) {
  for (const clip of track.clips) {
    if (clip.type !== "midi") continue;
    if (tick < clip.startTick || tick >= clip.startTick + clip.durationTicks)
      continue;
    const pattern = project.patterns[clip.patternId];
    if (!pattern) continue;
    if (!clip.loop && tick - clip.startTick >= pattern.lengthTicks) {
      // Silent tail of a clip that is longer than its pattern. When no other clip shares the
      // pattern it can simply grow to fill the clip; nothing that already plays changes.
      const shared = project.tracks.some((other) =>
        other.clips.some(
          (item) =>
            item !== clip &&
            item.type === "midi" &&
            item.patternId === clip.patternId,
        ),
      );
      if (shared) continue;
      pattern.lengthTicks = clip.durationTicks;
    }
    return clip;
  }
  return null;
}
const hasNote = (notes: MidiNote[], pitch: number, startTick: number) =>
  notes.some((note) => note.pitch === pitch && note.startTick === startTick);

/** Turns a raw MIDI message into a note event, or null for anything else (clock, pedals…).
 * A note-on with velocity 0 is a note-off, as the MIDI specification allows. */
export function parseMidiMessage(
  data: ArrayLike<number> | null | undefined,
): { type: "on" | "off"; pitch: number; velocity: number } | null {
  if (!data || data.length < 3) return null;
  const command = data[0] & 0xf0;
  const pitch = data[1] & 0x7f;
  const velocity = (data[2] & 0x7f) / 127;
  if (command === 0x90 && velocity > 0) return { type: "on", pitch, velocity };
  if (command === 0x80 || command === 0x90)
    return { type: "off", pitch, velocity: 0 };
  return null;
}

/** Computer-keyboard layout: the home row is the white keys from C, the row above the black. */
export const TYPING_KEYS = [
  "KeyA",
  "KeyW",
  "KeyS",
  "KeyE",
  "KeyD",
  "KeyF",
  "KeyT",
  "KeyG",
  "KeyY",
  "KeyH",
  "KeyU",
  "KeyJ",
  "KeyK",
  "KeyO",
  "KeyL",
  "KeyP",
  "Semicolon",
];
/** On a drum track the home row plays the kit: kick, snare, hats, clap, percussion. */
export const TYPING_DRUMS: Record<string, number> = {
  KeyA: 36,
  KeyS: 38,
  KeyD: 42,
  KeyF: 46,
  KeyG: 39,
  KeyH: 37,
};
/** The pitch a physical key plays, or null when the key is not part of the layout. */
export function typedPitch(
  code: string,
  octave: number,
  drums: boolean,
): number | null {
  if (drums) return TYPING_DRUMS[code] ?? null;
  const index = TYPING_KEYS.indexOf(code);
  if (index < 0) return null;
  const pitch = (octave + 1) * 12 + index;
  return pitch <= 127 ? pitch : null;
}
