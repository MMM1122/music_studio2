import {
  BAR,
  INSTRUMENTS,
  uid,
  type InstrumentType,
  type MidiClip,
  type MidiNote,
  type Pattern,
  type Project,
  type Track,
} from "./models";
import { chordNotes } from "./theory";

export function createNote(
  pitch: number,
  startTick: number,
  durationTicks: number,
  velocity = 0.8,
): MidiNote {
  return {
    id: uid(),
    pitch: Math.min(127, Math.max(0, Math.round(pitch))),
    startTick: Math.max(0, Math.round(startTick)),
    durationTicks: Math.max(1, Math.round(durationTicks)),
    velocity: Math.min(1, Math.max(0.01, velocity)),
  };
}
export function createTrack(type: InstrumentType | "audio"): Track {
  const preset = INSTRUMENTS.find((p) => p.type === type) ?? INSTRUMENTS[0];
  return {
    id: uid(),
    name: type === "audio" ? "Audio" : preset.name,
    type: type === "audio" ? "audio" : type === "drum-kit" ? "drums" : "midi",
    color: type === "audio" ? "taupe" : preset.color,
    instrument: {
      type: preset.type,
      attack: type === "synth-pad" ? 0.12 : 0.005,
      release: type === "synth-pad" ? 0.8 : type === "synth-bass" ? 0.12 : 0.35,
      brightness: 0.55,
    },
    mixer: {
      volume: type === "synth-bass" ? 0.72 : 0.7,
      pan: 0,
      mute: false,
      solo: false,
    },
    effects: {
      reverb:
        type === "electric-piano" ? 0.16 : type === "synth-pad" ? 0.28 : 0.05,
      delay: 0,
      filter: 16000,
    },
    clips: [],
  };
}
export function createPattern(
  kind: Pattern["kind"] = "midi",
  lengthTicks = kind === "drums" ? BAR : BAR * 4,
): Pattern {
  return {
    id: uid(),
    name: kind === "drums" ? "New groove" : "New phrase",
    lengthTicks,
    kind,
    notes: [],
    swing: 0,
  };
}
export function createMidiClip(pattern: Pattern, startTick = 0): MidiClip {
  return {
    id: uid(),
    type: "midi",
    name: pattern.name,
    startTick,
    durationTicks: pattern.lengthTicks,
    loop: true,
    gain: 1,
    patternId: pattern.id,
  };
}
export function createProject(
  name = "Untitled session",
  demo = false,
): Project {
  if (demo) return createDemoProject();
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: uid(),
    name,
    createdAt: now,
    updatedAt: now,
    key: "C minor",
    transport: {
      bpm: 90,
      timeSignature: [4, 4],
      loop: true,
      loopStart: 0,
      loopEnd: BAR * 16,
    },
    masterVolume: 0.8,
    tracks: [],
    patterns: {},
    assets: [],
  };
}
export function createDemoProject(): Project {
  const project = createProject("Sunday, softly");
  project.transport.bpm = 86;
  const drums = createTrack("drum-kit");
  drums.name = "Pocket drums";
  drums.mixer.volume = 0.68;
  const keys = createTrack("electric-piano");
  keys.name = "Velvet keys";
  keys.mixer.volume = 0.62;
  const bass = createTrack("synth-bass");
  bass.name = "Round bass";
  bass.mixer.volume = 0.6;
  const pad = createTrack("synth-pad");
  pad.name = "Air & texture";
  pad.mixer.volume = 0.24;
  pad.mixer.pan = 0.15;
  const groove = createPattern("drums", BAR);
  groove.name = "Sunday pocket";
  groove.swing = 0.12;
  for (const step of [0, 6, 8, 14])
    groove.notes.push(
      createNote(36, step * 120, 100, step === 0 ? 0.95 : 0.76),
    );
  for (const step of [4, 12]) {
    groove.notes.push(createNote(38, step * 120, 110, 0.8));
    groove.notes.push(createNote(39, step * 120, 90, 0.3));
  }
  for (const step of [0, 2, 4, 6, 8, 10, 12, 14])
    groove.notes.push(
      createNote(42, step * 120, 70, step % 4 === 0 ? 0.45 : 0.28),
    );
  groove.notes.push(createNote(46, 15 * 120, 100, 0.25));
  const fill = structuredClone(groove);
  fill.id = uid();
  fill.name = "Pocket variation";
  fill.notes = fill.notes.map((n) => ({ ...n, id: uid() }));
  fill.notes.push(
    createNote(38, 11 * 120, 90, 0.32),
    createNote(37, 15 * 120, 80, 0.5),
  );
  const chords = createPattern("midi", BAR * 4);
  chords.name = "Cm9 · A♭maj7 · E♭maj9 · G7";
  chords.notes = [
    chordNotes(48, "min9", 0, BAR - 60, 0.65),
    chordNotes(44, "maj7", BAR, BAR - 60, 0.62),
    chordNotes(51, "maj9", BAR * 2, BAR - 60, 0.58),
    chordNotes(43, "7", BAR * 3, BAR - 60, 0.64),
  ].flat();
  const bassline = createPattern("midi", BAR * 4);
  bassline.name = "Under the surface";
  [36, 32, 39, 31].forEach((pitch, bar) => {
    bassline.notes.push(
      createNote(pitch, bar * BAR, 600, 0.83),
      createNote(pitch + 12, bar * BAR + 840, 240, 0.5),
      createNote(pitch + 7, bar * BAR + 1200, 360, 0.62),
      createNote(pitch + 12, bar * BAR + 1680, 180, 0.46),
    );
  });
  const texture = createPattern("midi", BAR * 4);
  texture.name = "A little room";
  texture.notes = [
    createNote(67, 0, BAR * 2 - 120, 0.38),
    createNote(74, 0, BAR * 2 - 120, 0.3),
    createNote(67, BAR * 2, BAR * 2 - 120, 0.34),
    createNote(70, BAR * 2, BAR * 2 - 120, 0.3),
  ];
  for (const pattern of [groove, fill, chords, bassline, texture])
    project.patterns[pattern.id] = pattern;
  for (let section = 0; section < 4; section++) {
    const drumClip = createMidiClip(
      section % 2 === 0 ? groove : fill,
      section * BAR * 4,
    );
    drumClip.durationTicks = BAR * 4;
    drums.clips.push(drumClip);
    keys.clips.push(createMidiClip(chords, section * BAR * 4));
    if (section > 0)
      bass.clips.push(createMidiClip(bassline, section * BAR * 4));
    if (section === 1 || section === 3)
      pad.clips.push(createMidiClip(texture, section * BAR * 4));
  }
  project.tracks = [drums, keys, bass, pad];
  return project;
}
