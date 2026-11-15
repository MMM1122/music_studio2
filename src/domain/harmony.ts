import { BAR, type Project } from "./models";
import {
  CHORD_INTERVALS,
  chordSymbol,
  diatonicChords,
  parseKey,
  pitchClass,
  scalePitchClasses,
  type ChordQuality,
} from "./theory";

/** A chord as harmony, independent of register or voicing. `root` is a pitch class. */
export interface Chord {
  root: number;
  quality: ChordQuality;
}
export interface ChordSpan extends Chord {
  startTick: number;
  durationTicks: number;
}
/** A note placed on the song timeline (after clip position and looping are applied). */
export interface PlacedNote {
  pitch: number;
  startTick: number;
  durationTicks: number;
  velocity: number;
}

/** Pitched notes that sound in [fromTick, toTick), read from MIDI clips on non-drum tracks. */
export function pitchedNotesBetween(
  project: Pick<Project, "tracks" | "patterns">,
  fromTick: number,
  toTick: number,
): PlacedNote[] {
  const notes: PlacedNote[] = [];
  for (const track of project.tracks) {
    if (track.type !== "midi" || track.mixer.mute) continue;
    for (const clip of track.clips) {
      if (clip.type !== "midi") continue;
      const clipEnd = clip.startTick + clip.durationTicks;
      if (clipEnd <= fromTick || clip.startTick >= toTick) continue;
      const pattern = project.patterns[clip.patternId];
      if (!pattern || pattern.kind !== "midi" || pattern.lengthTicks <= 0)
        continue;
      const repeats = clip.loop
        ? Math.ceil(clip.durationTicks / pattern.lengthTicks)
        : 1;
      for (let repeat = 0; repeat < repeats; repeat++)
        for (const note of pattern.notes) {
          const local = repeat * pattern.lengthTicks + note.startTick;
          if (local >= clip.durationTicks) continue;
          const start = clip.startTick + local;
          const duration = Math.min(
            note.durationTicks,
            clip.durationTicks - local,
          );
          if (start + duration <= fromTick || start >= toTick) continue;
          notes.push({
            pitch: note.pitch,
            startTick: start,
            durationTicks: duration,
            velocity: note.velocity,
          });
        }
    }
  }
  return notes;
}

// Templates tried during detection, simplest first so ties resolve to the plainer name.
const DETECTABLE: ChordQuality[] = [
  "major",
  "minor",
  "7",
  "maj7",
  "min7",
  "min7b5",
  "dim7",
  "sus4",
  "9",
  "maj9",
  "min9",
  // Last, because its five tones overlap many chords: only an exact fit should win.
  "7alt",
];

/** Names the chord sounding in a window, or null when there is too little pitched material.
 * Weighs each pitch class by how long and how loudly it sounds; the lowest note leans the
 * result toward its own root so a bass line disambiguates rootless keyboard voicings. */
export function detectChord(
  notes: PlacedNote[],
  fromTick: number,
  toTick: number,
  scale?: number[],
): Chord | null {
  const weights = new Array<number>(12).fill(0);
  let lowest = Infinity;
  let lowestWeight = 0;
  for (const note of notes) {
    const overlap =
      Math.min(toTick, note.startTick + note.durationTicks) -
      Math.max(fromTick, note.startTick);
    if (overlap <= 0) continue;
    const weight = overlap * (0.4 + note.velocity * 0.6);
    weights[pitchClass(note.pitch)] += weight;
    if (
      note.pitch < lowest ||
      (note.pitch === lowest && weight > lowestWeight)
    ) {
      lowest = note.pitch;
      lowestWeight = weight;
    }
  }
  const total = weights.reduce((sum, value) => sum + value, 0);
  const distinct = weights.filter((value) => value > total * 0.04).length;
  if (total <= 0 || distinct < 2) return null;
  const bass = pitchClass(lowest);
  let best: Chord | null = null;
  let bestScore = -Infinity;
  for (let root = 0; root < 12; root++)
    for (const quality of DETECTABLE) {
      const tones = CHORD_INTERVALS[quality].map((i) => (root + i) % 12);
      let inside = 0;
      let missing = 0;
      for (const tone of tones) {
        inside += weights[tone];
        if (weights[tone] <= total * 0.02) missing++;
      }
      const outside = total - inside;
      // The third defines the chord; a template without its third sounding is a weak match.
      const third = tones[1];
      const score =
        inside / total -
        (outside / total) * 1.2 -
        missing * 0.11 +
        (root === bass ? 0.3 : 0) +
        (weights[root] > total * 0.04 ? 0.06 : -0.1) +
        (weights[third] > total * 0.04 ? 0.08 : -0.12) +
        // When the notes alone cannot decide (a bare fifth, say), prefer the chord the key expects.
        (scale && tones.every((tone) => scale.includes(tone)) ? 0.05 : 0) -
        tones.length * 0.004;
      if (score > bestScore + 1e-9) {
        bestScore = score;
        best = { root, quality };
      }
    }
  return bestScore > 0.25 ? best : null;
}

/** A believable default when the song has no harmony yet: i–VI–III–V in minor, I–vi–IV–V in major. */
export function defaultProgression(key: string): Chord[] {
  const chords = diatonicChords(key);
  const { mode } = parseKey(key);
  const pick = (degree: number, quality?: ChordQuality): Chord => ({
    root: chords[degree].root,
    quality: quality ?? chords[degree].quality,
  });
  return mode === "minor"
    ? [pick(0, "min9"), pick(5, "maj7"), pick(2, "maj9"), pick(4, "7")]
    : [pick(0, "maj9"), pick(5, "min7"), pick(3, "maj7"), pick(4, "9")];
}

export interface Progression {
  spans: ChordSpan[];
  /** True when the chords were read from the song, false when they are the key's default. */
  fromSong: boolean;
}
/** One chord per bar for `bars` bars from `startTick`. Bars with no readable harmony reuse the
 * previous bar's chord, or the key's default progression when the song has none at all. */
export function inferProgression(
  project: Pick<Project, "key"> & Partial<Pick<Project, "tracks" | "patterns">>,
  startTick = 0,
  bars = 4,
): Progression {
  const fallback = defaultProgression(project.key);
  const detected: (Chord | null)[] = [];
  if (project.tracks && project.patterns) {
    const from = Math.max(0, Math.floor(startTick / BAR) * BAR);
    const source = { tracks: project.tracks, patterns: project.patterns };
    const notes = pitchedNotesBetween(source, from, from + bars * BAR);
    const scale = scalePitchClasses(project.key);
    for (let bar = 0; bar < bars; bar++)
      detected.push(
        detectChord(notes, from + bar * BAR, from + (bar + 1) * BAR, scale),
      );
  }
  const found = detected.filter((chord) => chord !== null).length;
  const fromSong = found >= Math.max(1, Math.ceil(bars / 2));
  const spans: ChordSpan[] = [];
  let previous: Chord | null = null;
  for (let bar = 0; bar < bars; bar++) {
    const chord: Chord = fromSong
      ? (detected[bar] ??
        previous ??
        detected.find((item) => item !== null) ??
        fallback[bar % fallback.length])
      : fallback[bar % fallback.length];
    previous = chord;
    spans.push({ ...chord, startTick: bar * BAR, durationTicks: BAR });
  }
  return { spans, fromSong };
}
export function progressionLabel(spans: Chord[], key?: string): string {
  return spans
    .map((chord) => chordSymbol(chord.root, chord.quality, key))
    .join(" · ");
}

export type VoicingStyle = "close" | "rootless" | "shell" | "open";
/** Intervals above the root that a keyboard player would actually put under the hand. */
export function voicingIntervals(
  quality: ChordQuality,
  style: VoicingStyle,
): number[] {
  const base = CHORD_INTERVALS[quality];
  if (style === "close") return base;
  if (style === "shell") {
    const third = base[1];
    const seventh =
      base.find((i) => i === 10 || i === 11 || i === 9) ?? base[2];
    return [0, third, seventh];
  }
  // Rootless and open voicings leave the root to the bass and add colour on top.
  const rootless: Record<ChordQuality, number[]> = {
    major: [4, 7, 12, 14],
    minor: [3, 7, 12, 14],
    maj7: [4, 7, 11, 14],
    min7: [3, 7, 10, 14],
    "7": [4, 10, 14, 21],
    maj9: [4, 7, 11, 14],
    min9: [3, 7, 10, 14],
    "9": [4, 10, 14, 21],
    min7b5: [3, 6, 10, 12],
    dim7: [0, 3, 6, 9],
    sus4: [5, 7, 10, 14],
    "7alt": [4, 10, 13, 20],
  };
  return rootless[quality];
}

/** Places a chord's tones in a register so the hand moves as little as possible from `previous`.
 * Every inversion inside [low, high] is tried; the smoothest one wins. */
export function voiceChord(
  chord: Chord,
  style: VoicingStyle = "rootless",
  previous: number[] | null = null,
  low = 52,
  high = 77,
): number[] {
  const classes = [
    ...new Set(
      voicingIntervals(chord.quality, style).map((i) =>
        pitchClass(chord.root + i),
      ),
    ),
  ];
  const centre = (low + high) / 2;
  let best: number[] = [];
  let bestScore = Infinity;
  for (let rotation = 0; rotation < classes.length; rotation++) {
    const order = [...classes.slice(rotation), ...classes.slice(0, rotation)];
    for (let bottom = low; bottom < low + 12; bottom++) {
      if (pitchClass(bottom) !== order[0]) continue;
      const pitches = [bottom];
      for (let index = 1; index < order.length; index++) {
        let next = pitches[index - 1] + 1;
        while (pitchClass(next) !== order[index]) next++;
        pitches.push(next);
      }
      if (style === "open" && pitches.length >= 4)
        // Drop-2: the second voice from the top falls an octave, opening the middle.
        pitches.splice(0, 0, pitches.splice(pitches.length - 2, 1)[0] - 12);
      const top = pitches[pitches.length - 1];
      if (top > high + 4) continue;
      const mean = pitches.reduce((sum, p) => sum + p, 0) / pitches.length;
      let score: number;
      if (previous && previous.length) {
        const prevTop = Math.max(...previous);
        score =
          pitches.reduce(
            (sum, pitch) =>
              sum + Math.min(...previous.map((p) => Math.abs(p - pitch))),
            0,
          ) +
          Math.abs(top - prevTop) * 0.6 +
          Math.abs(mean - centre) * 0.15;
      } else score = Math.abs(mean - centre);
      if (score < bestScore) {
        bestScore = score;
        best = pitches;
      }
    }
  }
  return best.sort((a, b) => a - b);
}

/** Voices a whole progression with smooth voice leading from one chord to the next. */
export function voiceProgression(
  chords: Chord[],
  style: VoicingStyle = "rootless",
  low = 52,
  high = 77,
): number[][] {
  const voiced: number[][] = [];
  let previous: number[] | null = null;
  for (const chord of chords) {
    previous = voiceChord(chord, style, previous, low, high);
    voiced.push(previous);
  }
  return voiced;
}

/** Chord tones as pitch classes, root first. */
export function chordTones(chord: Chord): number[] {
  return [
    ...new Set(
      CHORD_INTERVALS[chord.quality].map((i) => pitchClass(chord.root + i)),
    ),
  ];
}
/** The pitch of class `pc` closest to `near`, kept inside [low, high]. */
export function nearestPitch(
  pc: number,
  near: number,
  low = 0,
  high = 127,
): number {
  let best = -1;
  for (let pitch = low; pitch <= high; pitch++)
    if (
      pitchClass(pitch) === pitchClass(pc) &&
      (best < 0 || Math.abs(pitch - near) < Math.abs(best - near))
    )
      best = pitch;
  return best < 0 ? Math.min(high, Math.max(low, near)) : best;
}
