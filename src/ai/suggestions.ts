import {
  BAR,
  uid,
  type InstrumentType,
  type Pattern,
  type Project,
} from "../domain/models";
import { createNote, createPattern } from "../domain/factories";
import { chordNotes, keyRoot, scalePitchClasses } from "../domain/theory";
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
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
/** Seed controls musical content. IDs remain fresh so accepted alternatives never alias. */
export function generateSuggestions(
  project: Pick<Project, "key" | "transport">,
  category: SuggestionCategory,
  seed = 1,
  sourcePattern?: Pattern,
): Suggestion[] {
  const root = keyRoot(project.key);
  const minor = project.key.includes("minor");
  const scale = scalePitchClasses(project.key);
  const progression = [
    root,
    (root + (minor ? 8 : 5)) % 12,
    (root + (minor ? 3 : 9)) % 12,
    (root + 7) % 12,
  ];
  return [0, 1, 2].map((variation) => {
    const rand = random(seed * 31 + variation * 107 + 1);
    const pattern = createPattern(
      category === "drums" ? "drums" : "midi",
      category === "drums" ? BAR : BAR * 4,
    );
    let instrument: InstrumentType = "electric-piano";
    const mood = ["Room to breathe", "Off the beat", "A softer turn"][
      variation
    ];
    pattern.name = mood;
    if (category === "bassline") {
      instrument = "synth-bass";
      progression.forEach((pitch, bar) => {
        const pulse =
          variation === 0
            ? [0, 960, 1560]
            : variation === 1
              ? [0, 720, 1320, 1680]
              : [0, 480, 1080, 1560];
        pulse.forEach((tick, i) =>
          pattern.notes.push(
            createNote(
              36 + pitch + (i === 2 ? 7 : i === 3 ? 12 : 0),
              bar * BAR + tick,
              Math.min(i === 0 ? 600 : 240, BAR - tick),
              0.65 + rand() * 0.2,
            ),
          ),
        );
      });
    } else if (category === "chords") {
      progression.forEach((pitch, bar) => {
        const quality =
          bar === 3
            ? "7"
            : bar === 0 && minor
              ? "min9"
              : bar === 2 && !minor
                ? "min7"
                : variation === 2
                  ? "maj9"
                  : "maj7";
        const notes = chordNotes(
          48 + pitch,
          quality,
          bar * BAR + (variation === 1 ? 120 : 0),
          BAR - (variation === 1 ? 240 : 120),
          0.6 + rand() * 0.12,
        );
        // Inversions preserve chord identity while making each suggestion distinct.
        if (variation > 0)
          notes.slice(0, variation).forEach((note) => {
            note.pitch += 12;
          });
        pattern.notes.push(...notes);
      });
    } else if (category === "drums") {
      instrument = "drum-kit";
      pattern.swing = [0.08, 0.2, 0.32][variation];
      for (let step = 0; step < 16; step++) {
        if (
          [0, 8, variation === 1 ? 7 : 6, variation === 2 ? 15 : 14].includes(
            step,
          )
        )
          pattern.notes.push(
            createNote(36, step * 120, 100, 0.68 + rand() * 0.25),
          );
        if ([4, 12].includes(step))
          pattern.notes.push(createNote(38, step * 120, 100, 0.72));
        if (step % 2 === 0 || (variation > 0 && rand() > 0.7))
          pattern.notes.push(
            createNote(42, step * 120, 70, 0.25 + rand() * 0.25),
          );
      }
      if (variation > 0) pattern.notes.push(createNote(37, 1800, 100, 0.42));
    } else if (
      (category === "rhythm" || category === "continue") &&
      sourcePattern &&
      sourcePattern.notes.length
    ) {
      pattern.kind = sourcePattern.kind;
      pattern.lengthTicks = sourcePattern.lengthTicks;
      instrument =
        sourcePattern.kind === "drums" ? "drum-kit" : "electric-piano";
      if (category === "rhythm") {
        pattern.notes = sourcePattern.notes.map((note, index) => {
          const shift =
            (index + variation) % 3 === 0 ? (variation === 1 ? -120 : 120) : 0;
          const startTick = Math.max(
            0,
            Math.min(
              pattern.lengthTicks - note.durationTicks,
              note.startTick + shift,
            ),
          );
          return {
            ...note,
            id: uid(),
            startTick,
            velocity: Math.min(1, note.velocity * (0.85 + rand() * 0.3)),
          };
        });
        pattern.swing = [0.08, 0.18, 0.28][variation];
      } else {
        const phrase = sourcePattern.notes.filter(
          (note) =>
            note.startTick >= Math.max(0, sourcePattern.lengthTicks - BAR * 2),
        );
        const basis = phrase.length ? phrase : sourcePattern.notes;
        const firstTick = Math.min(...basis.map((note) => note.startTick));
        const period = Math.max(BAR, sourcePattern.lengthTicks - firstTick);
        for (let repeat = 0; repeat * period < pattern.lengthTicks; repeat++) {
          for (const note of basis) {
            const startTick = note.startTick - firstTick + repeat * period;
            if (startTick >= pattern.lengthTicks) continue;
            const direction = variation === 0 ? 0 : variation === 1 ? 2 : -2;
            let pitch =
              pattern.kind === "drums"
                ? note.pitch
                : Math.min(127, Math.max(0, note.pitch + direction));
            if (pattern.kind === "midi")
              while (!scale.includes(pitch % 12) && pitch < 127) pitch++;
            pattern.notes.push(
              createNote(
                pitch,
                startTick,
                Math.min(note.durationTicks, pattern.lengthTicks - startTick),
                note.velocity * (0.85 + rand() * 0.15),
              ),
            );
          }
        }
      }
    } else {
      instrument = "lead-synth";
      const pitches = scale.map((pc) => 60 + pc).sort((a, b) => a - b);
      for (let bar = 0; bar < 4; bar++) {
        const rhythm =
          variation === 0
            ? [0, 720, 1200]
            : variation === 1
              ? [240, 720, 1080, 1560]
              : [0, 480, 1440];
        rhythm.forEach((tick, i) => {
          const index =
            (bar + i + variation + Math.floor(rand() * 3)) % pitches.length;
          pattern.notes.push(
            createNote(
              pitches[index],
              bar * BAR + tick,
              Math.min(variation === 2 ? 420 : 300, BAR - tick),
              0.5 + rand() * 0.22,
            ),
          );
        });
      }
    }
    return {
      id: uid(),
      name: mood,
      description: `${variation === 0 ? "Spacious and grounded" : variation === 1 ? "A little syncopation" : "Gentle movement"} · ${project.key} · ${project.transport.bpm} BPM`,
      pattern: validatePattern(pattern),
      instrument,
    };
  });
}
