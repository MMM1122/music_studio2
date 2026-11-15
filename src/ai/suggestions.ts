import {
  BAR,
  uid,
  type InstrumentType,
  type MidiNote,
  type Pattern,
  type Project,
} from "../domain/models";
import { createNote, createPattern } from "../domain/factories";
import {
  chordTones,
  inferProgression,
  nearestPitch,
  progressionLabel,
  voiceProgression,
  type ChordSpan,
} from "../domain/harmony";
import { pitchClass, scalePitchClasses } from "../domain/theory";
import { validatePattern } from "../domain/validation";

export type SuggestionCategory =
  | "bassline"
  | "melody"
  | "chords"
  | "drums"
  | "rhythm"
  | "continue";
export interface Suggestion {
  id: string;
  name: string;
  description: string;
  pattern: Pattern;
  instrument: InstrumentType;
}
export const IDEA_CATEGORIES: { id: SuggestionCategory; label: string }[] = [
  { id: "bassline", label: "Bassline" },
  { id: "melody", label: "Melody" },
  { id: "chords", label: "Chord voicings" },
  { id: "drums", label: "Drum variation" },
  { id: "rhythm", label: "Rhythmic variation" },
  { id: "continue", label: "Continue a phrase" },
];
/** What the generator may read. Tracks and patterns are optional: with them, ideas follow the
 * chords already in the song; without them, they follow the key's default progression. */
export type SuggestionProject = Pick<Project, "key" | "transport"> &
  Partial<Pick<Project, "tracks" | "patterns">>;

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
const STEP = 120;
type Cell = [tick: number, duration: number][];

interface Draft {
  name: string;
  description: string;
  instrument: InstrumentType;
  kind: Pattern["kind"];
  lengthTicks: number;
  swing: number;
  notes: MidiNote[];
}

/* ---------- Bass ---------- */
function bassline(
  spans: ChordSpan[],
  scale: number[],
  variation: number,
  rand: () => number,
): Omit<Draft, "kind" | "lengthTicks"> {
  const notes: MidiNote[] = [];
  const roots = spans.map((chord) => nearestPitch(chord.root, 36, 28, 43));
  spans.forEach((chord, bar) => {
    const at = bar * BAR;
    const root = roots[bar];
    const next = roots[(bar + 1) % roots.length];
    const tones = chordTones(chord);
    const fifth =
      root + (((tones[2] ?? chord.root + 7) - chord.root + 12) % 12);
    const seventh =
      tones[3] !== undefined
        ? nearestPitch(tones[3], root + 9, root, root + 12)
        : root + 12;
    // Step into the next root: a scale tone from below when there is one a whole step or
    // less away, otherwise a half step, which always leads the ear.
    const below = [next - 2, next - 1].find((pitch) =>
      scale.includes(pitchClass(pitch)),
    );
    const approach = variation === 1 ? next - 1 : (below ?? next - 1);
    const touch = () => 0.94 + rand() * 0.1;
    if (variation === 0) {
      notes.push(
        createNote(root, at, 720, 0.86 * touch()),
        createNote(fifth, at + 1200, 300, 0.66 * touch()),
        createNote(approach, at + 1680, 200, 0.58 * touch()),
      );
    } else if (variation === 1) {
      notes.push(
        createNote(root, at, 400, 0.88 * touch()),
        createNote(root + 12, at + 600, 100, 0.5 * touch()),
        createNote(root, at + 840, 200, 0.66 * touch()),
        createNote(seventh, at + 1080, 220, 0.6 * touch()),
        createNote(fifth, at + 1440, 200, 0.68 * touch()),
        createNote(approach, at + 1800, 110, 0.56 * touch()),
      );
    } else {
      notes.push(
        createNote(root, at, 900, 0.84 * touch()),
        createNote(bar % 2 ? fifth : root + 12, at + 960, 660, 0.62 * touch()),
        createNote(approach, at + 1680, 220, 0.54 * touch()),
      );
    }
  });
  return {
    name: ["Room to breathe", "Off the beat", "A softer turn"][variation],
    description: [
      "Root, fifth, and a step into the next chord",
      "Syncopated, with octave pops and a leading tone",
      "Long notes that leave the groove open",
    ][variation],
    instrument: "synth-bass",
    swing: [0.1, 0.16, 0.08][variation],
    notes,
  };
}

/* ---------- Melody ---------- */
const CELLS: Record<string, Cell> = {
  pickup: [
    [960, 220],
    [1200, 220],
    [1440, 420],
  ],
  fall: [
    [0, 660],
    [720, 200],
    [960, 420],
    [1440, 360],
  ],
  hold: [
    [0, 900],
    [1200, 220],
    [1440, 220],
    [1680, 220],
  ],
  rest: [
    [0, 600],
    [720, 240],
    [960, 780],
  ],
  climb: [
    [240, 200],
    [480, 220],
    [720, 400],
    [1200, 600],
  ],
  push: [
    [0, 420],
    [480, 200],
    [720, 200],
    [960, 780],
  ],
};
// Each phrase is a question (two bars) and an answer (two bars); the last bar always rests.
const PHRASES = [
  ["pickup", "fall", "hold", "rest"],
  ["push", "fall", "climb", "rest"],
  ["hold", "rest", "pickup", "fall"],
];
function melody(
  spans: ChordSpan[],
  scale: number[],
  variation: number,
  rand: () => number,
): Omit<Draft, "kind" | "lengthTicks"> {
  const ladder: number[] = [];
  for (let pitch = 60; pitch <= 84; pitch++)
    if (scale.includes(pitchClass(pitch))) ladder.push(pitch);
  const rung = (pitch: number) =>
    ladder.reduce(
      (best, value, index) =>
        Math.abs(value - pitch) < Math.abs(ladder[best] - pitch) ? index : best,
      0,
    );
  const notes: MidiNote[] = [];
  let current = ladder[rung(67 + variation * 3)];
  spans.forEach((chord, bar) => {
    const cell = CELLS[PHRASES[variation][bar % 4]];
    const tones = chordTones(chord);
    // Bars alternate rising and falling so the line has a shape rather than a drift.
    let direction = bar % 2 === 0 ? 1 : -1;
    if (current > 79) direction = -1;
    if (current < 64) direction = 1;
    cell.forEach(([tick, duration], index) => {
      const last = index === cell.length - 1;
      const strong = index === 0 || last || duration >= 400;
      const stride = rand() < 0.3 ? 2 : 1;
      const target =
        ladder[
          Math.min(
            ladder.length - 1,
            Math.max(
              0,
              rung(current) + (index === 0 && bar > 0 ? 0 : direction * stride),
            ),
          )
        ];
      // Notes the ear lands on belong to the chord; the notes between them pass through the scale.
      let pitch = target;
      if (strong) {
        const choices = tones
          .map((tone) => nearestPitch(tone, target, 60, 84))
          .sort((a, b) => Math.abs(a - target) - Math.abs(b - target));
        pitch =
          choices.find((choice) => choice !== current || last) ?? choices[0];
      }
      notes.push(
        createNote(
          pitch,
          bar * BAR + tick,
          duration,
          (strong ? 0.7 : 0.58) + rand() * 0.1,
        ),
      );
      current = pitch;
    });
  });
  return {
    name: ["Room to breathe", "Off the beat", "A softer turn"][variation],
    description: [
      "A question, then an answer that lands on chord tones",
      "Starts on the beat and climbs in the third bar",
      "Long notes first, movement after",
    ][variation],
    instrument: variation === 1 ? "pluck" : "lead-synth",
    swing: 0.12,
    notes,
  };
}

/* ---------- Chords ---------- */
function chords(
  spans: ChordSpan[],
  variation: number,
  rand: () => number,
): Omit<Draft, "kind" | "lengthTicks"> {
  const style = variation === 2 ? "open" : "rootless";
  const voiced = voiceProgression(spans, style);
  const notes: MidiNote[] = [];
  const hit = (
    pitches: number[],
    at: number,
    duration: number,
    velocity: number,
    spread: number,
  ) =>
    pitches.forEach((pitch, index) =>
      notes.push(
        createNote(
          pitch,
          at + index * spread,
          duration - index * spread,
          velocity + (index === pitches.length - 1 ? 0.06 : 0) + rand() * 0.04,
        ),
      ),
    );
  spans.forEach((chord, bar) => {
    const at = bar * BAR;
    const pitches = voiced[bar];
    if (variation === 0) {
      // Held, with the root underneath so the idea stands on its own without a bass.
      notes.push(
        createNote(nearestPitch(chord.root, 43, 36, 47), at, BAR - 90, 0.5),
      );
      hit(pitches, at, BAR - 90, 0.56, 14);
    } else if (variation === 1) {
      hit(pitches, at, 600, 0.64, 8);
      hit(pitches, at + 720, 780, 0.52, 8);
      if (bar % 2 === 1)
        hit(voiced[(bar + 1) % voiced.length], at + 1800, 110, 0.44, 0);
    } else {
      // Broken: bottom, top, then the inner voices, one eighth at a time.
      const order = [
        0,
        pitches.length - 1,
        1,
        2,
        pitches.length - 1,
        1,
        2,
        1,
      ].map((index) => pitches[Math.min(index, pitches.length - 1)]);
      order.forEach((pitch, index) =>
        notes.push(
          createNote(
            pitch,
            at + index * 240,
            index === 0 ? 900 : Math.min(420, BAR - index * 240 - 20),
            (index % 4 === 0 ? 0.66 : 0.5) + rand() * 0.05,
          ),
        ),
      );
    }
  });
  return {
    name: ["Room to breathe", "Off the beat", "A softer turn"][variation],
    description: [
      "Held rootless voicings that move by step",
      "Two hits a bar, the second one pushed",
      "Open voicings played as broken chords",
    ][variation],
    instrument: variation === 2 ? "felt-piano" : "electric-piano",
    swing: variation === 1 ? 0.14 : 0,
    notes,
  };
}

/* ---------- Drums ---------- */
const KICK = 36;
const SNARE = 38;
const RIM = 37;
const CLAP = 39;
const HAT = 42;
const OPEN = 46;
function drums(
  bpm: number,
  variation: number,
  rand: () => number,
): Omit<Draft, "kind" | "lengthTicks"> {
  const notes: MidiNote[] = [];
  const add = (pitch: number, step: number, velocity: number, bar = 0) =>
    notes.push(
      createNote(
        pitch,
        bar * BAR + step * STEP,
        pitch === OPEN ? 110 : 80,
        Math.min(1, velocity * (0.95 + rand() * 0.1)),
      ),
    );
  const fast = bpm >= 108;
  for (let bar = 0; bar < 2; bar++) {
    const fill = bar === 1;
    if (variation === 0) {
      // The pocket: kick on one, a pickup before three, backbeat with ghost notes around it.
      [0, 7, 10].forEach((step, index) =>
        add(KICK, step, [0.95, 0.6, 0.82][index], bar),
      );
      [4, 12].forEach((step) => add(SNARE, step, 0.86, bar));
      [9, 15].forEach((step) => add(SNARE, step, 0.2, bar));
      for (let step = 0; step < 16; step += 2)
        if (!(fill && step === 14))
          add(HAT, step, step % 4 === 0 ? 0.52 : 0.3, bar);
      if (fill) {
        add(OPEN, 14, 0.34, bar);
        add(KICK, 13, 0.5, bar);
      }
    } else if (variation === 1) {
      // Busier hats and a kick that answers itself.
      [0, 3, 10, 11].forEach((step, index) =>
        add(KICK, step, [0.95, 0.55, 0.8, 0.5][index], bar),
      );
      [4, 12].forEach((step) => {
        add(SNARE, step, 0.84, bar);
        add(CLAP, step, 0.28, bar);
      });
      for (let step = 0; step < 16; step++)
        if (step !== 6)
          add(
            HAT,
            step,
            step % 4 === 0 ? 0.5 : step % 2 === 0 ? 0.34 : 0.18,
            bar,
          );
      add(OPEN, 6, 0.3, bar);
      if (fill)
        [13, 14, 15].forEach((step, index) =>
          add(SNARE, step, 0.24 + index * 0.16, bar),
        );
    } else if (fast) {
      // At faster tempos the third idea is four on the floor with off-beat open hats.
      [0, 4, 8, 12].forEach((step) => add(KICK, step, 0.92, bar));
      [4, 12].forEach((step) => add(CLAP, step, 0.6, bar));
      [2, 6, 10, 14].forEach((step) => add(OPEN, step, 0.3, bar));
      [3, 7, 11, 15].forEach((step) => add(HAT, step, 0.2, bar));
      if (fill) add(SNARE, 15, 0.4, bar);
    } else {
      // Half-time: one backbeat a bar, a rim on two, plenty of air.
      [0, 6, 10].forEach((step, index) =>
        add(KICK, step, [0.92, 0.52, 0.7][index], bar),
      );
      add(RIM, 4, 0.56, bar);
      add(SNARE, 12, 0.86, bar);
      add(CLAP, 12, 0.3, bar);
      [2, 6, 10, 14].forEach((step) => add(HAT, step, 0.36, bar));
      [0, 8].forEach((step) => add(HAT, step, 0.22, bar));
      if (fill) {
        add(RIM, 14, 0.4, bar);
        add(RIM, 15, 0.5, bar);
      }
    }
  }
  return {
    name: ["Room to breathe", "Off the beat", "A softer turn"][variation],
    description: [
      "Pocket groove with ghost notes and a turnaround",
      "Sixteenth hats, an answering kick, a snare build",
      fast
        ? "Four on the floor with off-beat hats"
        : "Half-time with a rim on two",
    ][variation],
    instrument: "drum-kit",
    swing: [0.16, 0.1, fast ? 0 : 0.2][variation],
    notes,
  };
}

/* ---------- Variations on the user's own pattern ---------- */
function rhythm(
  source: Pattern,
  variation: number,
  rand: () => number,
): MidiNote[] {
  return source.notes.map((note, index) => {
    // Push or pull every third note by a sixteenth; leave downbeats where they are.
    const onDownbeat = note.startTick % BAR === 0;
    const shift =
      !onDownbeat && (index + variation) % 3 === 0
        ? variation === 1
          ? -STEP
          : STEP
        : 0;
    const startTick = Math.max(
      0,
      Math.min(source.lengthTicks - note.durationTicks, note.startTick + shift),
    );
    return {
      ...note,
      id: uid(),
      startTick,
      velocity: Math.min(
        1,
        Math.max(0.05, note.velocity * (0.85 + rand() * 0.3)),
      ),
    };
  });
}
function continuation(
  source: Pattern,
  scale: number[],
  variation: number,
  rand: () => number,
): MidiNote[] {
  const tail = source.notes.filter(
    (note) => note.startTick >= Math.max(0, source.lengthTicks - BAR * 2),
  );
  const basis = tail.length ? tail : source.notes;
  const firstTick = Math.min(...basis.map((note) => note.startTick));
  const period = Math.max(BAR, source.lengthTicks - firstTick);
  // Move by scale steps, not semitones, so the sequence stays in key.
  const steps = [0, 2, -2][variation];
  const transpose = (pitch: number) => {
    if (source.kind === "drums" || steps === 0) return pitch;
    let value = pitch;
    for (let moved = 0; moved < Math.abs(steps); ) {
      value += Math.sign(steps);
      if (value < 0 || value > 127) return pitch;
      if (scale.includes(pitchClass(value))) moved++;
    }
    return value;
  };
  const notes: MidiNote[] = [];
  for (let repeat = 0; repeat * period < source.lengthTicks; repeat++)
    for (const note of basis) {
      const startTick = note.startTick - firstTick + repeat * period;
      if (startTick >= source.lengthTicks) continue;
      notes.push(
        createNote(
          transpose(note.pitch),
          startTick,
          Math.min(note.durationTicks, source.lengthTicks - startTick),
          note.velocity * (0.85 + rand() * 0.15),
        ),
      );
    }
  return notes;
}

/** Three alternatives for one category. The seed fixes the musical content; IDs are always
 * fresh, so accepting the same idea twice never aliases notes. Nothing in `project` is changed.
 * `atTick` is where the idea will be placed: the chords are read from the song at that bar. */
export function generateSuggestions(
  project: SuggestionProject,
  category: SuggestionCategory,
  seed = 1,
  sourcePattern?: Pattern,
  atTick = 0,
): Suggestion[] {
  const scale = scalePitchClasses(project.key);
  const { spans, fromSong } = inferProgression(project, atTick, 4);
  const harmony = `${fromSong ? "Follows" : "Suggests"} ${progressionLabel(spans, project.key)}`;
  const context = `${project.key} · ${project.transport.bpm} BPM`;
  const usesSource =
    (category === "rhythm" || category === "continue") &&
    !!sourcePattern &&
    sourcePattern.notes.length > 0;
  return [0, 1, 2].map((variation) => {
    const rand = random(seed * 31 + variation * 107 + 1);
    let draft: Draft;
    if (usesSource && sourcePattern) {
      draft = {
        name: ["Room to breathe", "Off the beat", "A softer turn"][variation],
        description:
          category === "rhythm"
            ? [
                "Later by a sixteenth here and there",
                "Earlier, leaning forward",
                "Later, with more swing",
              ][variation]
            : [
                "Your last two bars, repeated",
                "Your phrase, two scale steps up",
                "Your phrase, two scale steps down",
              ][variation],
        instrument:
          sourcePattern.kind === "drums" ? "drum-kit" : "electric-piano",
        kind: sourcePattern.kind,
        lengthTicks: sourcePattern.lengthTicks,
        swing:
          category === "rhythm"
            ? [0.08, 0.18, 0.28][variation]
            : sourcePattern.swing,
        notes:
          category === "rhythm"
            ? rhythm(sourcePattern, variation, rand)
            : continuation(sourcePattern, scale, variation, rand),
      };
    } else if (category === "drums")
      draft = {
        ...drums(project.transport.bpm, variation, rand),
        kind: "drums",
        lengthTicks: BAR * 2,
      };
    else if (category === "bassline")
      draft = {
        ...bassline(spans, scale, variation, rand),
        kind: "midi",
        lengthTicks: BAR * 4,
      };
    else if (category === "chords")
      draft = {
        ...chords(spans, variation, rand),
        kind: "midi",
        lengthTicks: BAR * 4,
      };
    else
      draft = {
        ...melody(spans, scale, variation, rand),
        kind: "midi",
        lengthTicks: BAR * 4,
      };
    const pattern = createPattern(draft.kind, draft.lengthTicks);
    pattern.name = draft.name;
    pattern.swing = draft.swing;
    pattern.notes = draft.notes;
    const pitched = draft.kind === "midi" && !usesSource;
    return {
      id: uid(),
      name: draft.name,
      description: `${draft.description} · ${pitched ? harmony : context}`,
      pattern: validatePattern(pattern),
      instrument: draft.instrument,
    };
  });
}
