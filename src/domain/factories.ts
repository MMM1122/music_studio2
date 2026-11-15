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
      attack: preset.attack,
      release: preset.release,
      brightness: preset.brightness,
    },
    mixer: {
      volume: type === "audio" ? 0.7 : preset.volume,
      pan: 0,
      mute: false,
      solo: false,
    },
    effects: {
      reverb: type === "audio" ? 0.05 : preset.reverb,
      delay: type === "audio" ? 0 : preset.delay,
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
/** Chord tones for the demo, voiced by hand so each chord moves to the next by a step or two.
 * The bass plays the roots, so the keys leave them out. */
const DEMO_VOICINGS = {
  Cm9: [51, 55, 58, 62],
  Abmaj9: [51, 55, 58, 60],
  Ebmaj9: [50, 53, 55, 58],
  G7alt: [53, 56, 59, 63],
  Fm9: [51, 55, 56, 60],
  Bb13: [50, 55, 56, 60],
} as const;
type DemoChord = keyof typeof DEMO_VOICINGS;
const DEMO_ROOTS: Record<DemoChord, number> = {
  Cm9: 36,
  Abmaj9: 32,
  Ebmaj9: 39,
  G7alt: 31,
  Fm9: 41,
  Bb13: 34,
};
/** A chord struck the way a hand lands: lowest note first, top note a little louder. */
function strum(
  chord: DemoChord,
  startTick: number,
  durationTicks: number,
  velocity: number,
  spread = 9,
): MidiNote[] {
  const pitches = DEMO_VOICINGS[chord];
  return pitches.map((pitch, index) =>
    createNote(
      pitch,
      startTick + index * spread,
      durationTicks - index * spread,
      velocity +
        (index === pitches.length - 1 ? 0.07 : index === 0 ? 0.02 : -0.03),
    ),
  );
}

/** "Sunday, softly": sixteen bars of neo-soul in C minor at 86 BPM.
 * Bars 1–4 open with keys, pad and a rim click; 5–8 bring in the full groove and the theme;
 * 9–12 move through Fm9–B♭13–E♭maj9 for a lift; 13–16 return home and set up the loop. */
export function createDemoProject(): Project {
  const project = createProject("Sunday, softly");
  project.transport.bpm = 86;
  const swing = 0.16;
  const home: DemoChord[] = ["Cm9", "Abmaj9", "Ebmaj9", "G7alt"];
  const lift: DemoChord[] = ["Fm9", "Bb13", "Ebmaj9", "G7alt"];

  const drums = createTrack("drum-kit");
  drums.name = "Pocket drums";
  drums.mixer.volume = 0.7;
  drums.effects.reverb = 0.08;
  const keys = createTrack("electric-piano");
  keys.name = "Velvet keys";
  keys.mixer.volume = 0.62;
  keys.mixer.pan = -0.08;
  keys.effects.reverb = 0.24;
  const bass = createTrack("synth-bass");
  bass.name = "Round bass";
  bass.mixer.volume = 0.62;
  const pad = createTrack("synth-pad");
  pad.name = "Air & texture";
  pad.mixer.volume = 0.55;
  pad.mixer.pan = 0.12;
  pad.effects.reverb = 0.5;
  pad.effects.filter = 5200;
  const hook = createTrack("pluck");
  hook.name = "Small hours";
  hook.mixer.volume = 0.6;
  hook.mixer.pan = 0.14;
  hook.effects.reverb = 0.3;
  hook.effects.delay = 0.3;

  // Drums. Velocity carries the feel: loud backbeats, quiet ghost notes, hats that breathe.
  const step = (index: number) => index * 120;
  const hats = (pattern: Pattern, open: number[] = []) => {
    for (let index = 0; index < 16; index += 2)
      if (!open.includes(index))
        pattern.notes.push(
          createNote(42, step(index), 70, index % 4 === 0 ? 0.52 : 0.3),
        );
    for (const index of open)
      pattern.notes.push(createNote(46, step(index), 110, 0.34));
  };
  const intro = createPattern("drums", BAR);
  intro.name = "Rim & hats";
  intro.swing = swing;
  hats(intro);
  intro.notes.push(
    createNote(36, step(0), 100, 0.7),
    createNote(36, step(10), 100, 0.5),
    createNote(37, step(4), 90, 0.62),
    createNote(37, step(12), 90, 0.66),
    createNote(42, step(15), 60, 0.2),
  );
  const groove = createPattern("drums", BAR);
  groove.name = "Sunday pocket";
  groove.swing = swing;
  hats(groove);
  groove.notes.push(
    createNote(36, step(0), 100, 0.95),
    createNote(36, step(7), 100, 0.6),
    createNote(36, step(10), 100, 0.82),
    createNote(38, step(4), 110, 0.84),
    createNote(38, step(12), 110, 0.88),
    createNote(39, step(4), 90, 0.26),
    createNote(39, step(12), 90, 0.3),
    createNote(38, step(9), 80, 0.2),
    createNote(38, step(15), 80, 0.18),
    createNote(42, step(3), 60, 0.16),
    createNote(42, step(11), 60, 0.18),
  );
  const turn = createPattern("drums", BAR);
  turn.name = "Pocket variation";
  turn.swing = swing;
  hats(turn, [14]);
  turn.notes.push(
    createNote(36, step(0), 100, 0.95),
    createNote(36, step(7), 100, 0.58),
    createNote(36, step(10), 100, 0.8),
    createNote(36, step(13), 100, 0.5),
    createNote(38, step(4), 110, 0.84),
    createNote(38, step(12), 110, 0.9),
    createNote(39, step(12), 90, 0.32),
    createNote(38, step(9), 80, 0.2),
    createNote(38, step(14), 80, 0.36),
    createNote(38, step(15), 80, 0.56),
    createNote(37, step(6), 80, 0.3),
  );

  // Keys. The intro lets each chord ring; the comp answers the kick with a pushed second hit.
  const held = (name: string, chords: DemoChord[]) => {
    const pattern = createPattern("midi", BAR * 4);
    pattern.name = name;
    chords.forEach((chord, bar) =>
      pattern.notes.push(...strum(chord, bar * BAR, BAR - 90, 0.56, 16)),
    );
    return pattern;
  };
  const comp = (name: string, chords: DemoChord[]) => {
    const pattern = createPattern("midi", BAR * 4);
    pattern.name = name;
    pattern.swing = swing;
    chords.forEach((chord, bar) => {
      const at = bar * BAR;
      pattern.notes.push(
        ...strum(chord, at, 600, 0.66),
        ...strum(chord, at + 720, 780, 0.54),
      );
      // Every second bar leans into the next chord a sixteenth early.
      if (bar % 2 === 1)
        pattern.notes.push(
          ...strum(chords[(bar + 1) % chords.length], at + 1800, 110, 0.46, 0),
        );
    });
    return pattern;
  };
  const keysIntro = held("Cm9 · A♭maj9 · E♭maj9 · G7alt", home);
  const keysHome = comp("Home comp", home);
  const keysLift = comp("Fm9 · B♭13 · E♭maj9 · G7alt", lift);

  // Bass. Root on one, an octave pop, the fifth, then a step into the next root.
  const walk = (name: string, chords: DemoChord[], approaches: number[]) => {
    const pattern = createPattern("midi", BAR * 4);
    pattern.name = name;
    pattern.swing = swing;
    chords.forEach((chord, bar) => {
      const root = DEMO_ROOTS[chord];
      const at = bar * BAR;
      pattern.notes.push(
        createNote(root, at, 640, 0.9),
        createNote(root + 12, at + 840, 100, 0.5),
        createNote(root + (bar % 2 ? 12 : 7), at + 1200, 300, 0.7),
        createNote(approaches[bar], at + 1680, 200, 0.62),
      );
      if (bar % 2 === 1)
        pattern.notes.push(createNote(root, at + 1440, 110, 0.44));
    });
    return pattern;
  };
  // Approach notes: G→A♭, D→E♭, A♭→G, B→C, then for the lift A→B♭, D→E♭, A♭→G, B→C.
  const bassHome = walk("Under the surface", home, [31, 38, 32, 35]);
  const bassLift = walk("Under the lift", lift, [33, 38, 32, 35]);

  // Pad. Two guide tones per chord, held long, so the harmony glows without getting thick.
  const glow = (name: string, tones: [number, number, number, number][]) => {
    const pattern = createPattern("midi", BAR * 4);
    pattern.name = name;
    for (const [low, high, startBar, bars] of tones)
      pattern.notes.push(
        createNote(low, startBar * BAR, bars * BAR - 60, 0.44),
        createNote(high, startBar * BAR, bars * BAR - 60, 0.38),
      );
    return pattern;
  };
  const padHome = glow("A little room", [
    [67, 74, 0, 2],
    [67, 70, 2, 1],
    [65, 71, 3, 1],
  ]);
  const padLift = glow("A little higher", [
    [68, 72, 0, 2],
    [67, 70, 2, 1],
    [65, 71, 3, 1],
  ]);

  // The hook. A question in bars 5–8, a higher answer over the lift, then the question again
  // with an ending that hangs on the fifth and lets the loop resolve it.
  const line = (name: string, notes: [number, number, number, number][]) => {
    const pattern = createPattern("midi", BAR * 4);
    pattern.name = name;
    pattern.swing = swing;
    for (const [pitch, tick, duration, velocity] of notes)
      pattern.notes.push(createNote(pitch, tick, duration, velocity));
    return pattern;
  };
  const question: [number, number, number, number][] = [
    [67, 960, 220, 0.62],
    [70, 1200, 220, 0.66],
    [72, 1440, 420, 0.74],
    [75, BAR, 660, 0.78],
    [74, BAR + 720, 200, 0.6],
    [72, BAR + 960, 420, 0.68],
    [70, BAR + 1440, 360, 0.6],
    [67, BAR * 2, 900, 0.7],
    [70, BAR * 2 + 1200, 220, 0.6],
    [72, BAR * 2 + 1440, 220, 0.66],
    [74, BAR * 2 + 1680, 220, 0.7],
  ];
  const theme = line("Question", [
    ...question,
    [75, BAR * 3, 600, 0.76],
    [74, BAR * 3 + 720, 240, 0.62],
    [71, BAR * 3 + 960, 780, 0.7],
  ]);
  const answer = line("Answer", [
    [72, 0, 420, 0.7],
    [75, 480, 200, 0.64],
    [77, 720, 200, 0.68],
    [79, 960, 780, 0.8],
    [77, BAR, 420, 0.72],
    [74, BAR + 480, 240, 0.62],
    [72, BAR + 720, 220, 0.62],
    [68, BAR + 960, 720, 0.7],
    [67, BAR * 2 + 240, 200, 0.58],
    [70, BAR * 2 + 480, 220, 0.62],
    [74, BAR * 2 + 720, 400, 0.68],
    [77, BAR * 2 + 1200, 600, 0.76],
    [75, BAR * 3, 600, 0.74],
    [74, BAR * 3 + 720, 220, 0.62],
    [71, BAR * 3 + 960, 220, 0.64],
    [67, BAR * 3 + 1200, 660, 0.66],
  ]);
  const close = line("Question, held", [
    ...question,
    [75, BAR * 3, 600, 0.76],
    [74, BAR * 3 + 720, 1080, 0.68],
  ]);

  for (const pattern of [
    intro,
    groove,
    turn,
    keysIntro,
    keysHome,
    keysLift,
    bassHome,
    bassLift,
    padHome,
    padLift,
    theme,
    answer,
    close,
  ])
    project.patterns[pattern.id] = pattern;

  const place = (pattern: Pattern, startBar: number, bars: number) => {
    const clip = createMidiClip(pattern, startBar * BAR);
    clip.durationTicks = bars * BAR;
    return clip;
  };
  drums.clips.push(place(intro, 0, 4));
  for (const section of [4, 8, 12])
    drums.clips.push(place(groove, section, 3), place(turn, section + 3, 1));
  keys.clips.push(
    place(keysIntro, 0, 4),
    place(keysHome, 4, 4),
    place(keysLift, 8, 4),
    place(keysHome, 12, 4),
  );
  bass.clips.push(
    place(bassHome, 4, 4),
    place(bassLift, 8, 4),
    place(bassHome, 12, 4),
  );
  pad.clips.push(
    place(padHome, 0, 4),
    place(padLift, 8, 4),
    place(padHome, 12, 4),
  );
  hook.clips.push(place(theme, 4, 4), place(answer, 8, 4), place(close, 12, 4));
  project.tracks = [drums, keys, bass, pad, hook];
  return project;
}
