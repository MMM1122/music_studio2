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
 * 9–12 move through Fm9–B♭13–E♭maj9 for a lift; 13–16 return to the theme and resolve on Cm9, with room for the final chord to breathe. */
export function createDemoProject(): Project {
  const project = createProject("Sunday, softly");
  project.transport.bpm = 86;
  const swing = 0.16;
  const home: DemoChord[] = ["Cm9", "Abmaj9", "Ebmaj9", "G7alt"];
  const lift: DemoChord[] = ["Fm9", "Bb13", "Ebmaj9", "G7alt"];
  const cadence: DemoChord[] = ["Cm9", "Abmaj9", "G7alt", "Cm9"];

  const drums = createTrack("drum-kit");
  drums.name = "Pocket drums";
  drums.mixer.volume = 0.68;
  drums.effects.reverb = 0.06;
  const keys = createTrack("electric-piano");
  keys.name = "Velvet keys";
  keys.mixer.volume = 0.64;
  keys.mixer.pan = -0.08;
  keys.effects.reverb = 0.2;
  keys.instrument.brightness = 0.45;
  keys.instrument.release = 0.32;
  const bass = createTrack("synth-bass");
  bass.name = "Round bass";
  bass.mixer.volume = 0.65;
  const pad = createTrack("synth-pad");
  pad.name = "Air & texture";
  pad.mixer.volume = 0.37;
  pad.mixer.pan = 0.12;
  pad.effects.reverb = 0.32;
  pad.effects.filter = 4200;
  const hook = createTrack("pluck");
  hook.name = "Small hours";
  hook.mixer.volume = 0.52;
  hook.mixer.pan = 0.14;
  hook.effects.reverb = 0.24;
  hook.effects.delay = 0.18;
  hook.instrument.brightness = 0.42;
  hook.instrument.release = 0.24;

  // Drums. Kicks stay on the grid with the bass; snare and hats sit a few milliseconds behind.
  // These small offsets are composed, not random, so every playback keeps the same pocket.
  const step = (index: number) => index * 120;
  const hats = (pattern: Pattern, open: number[] = []) => {
    for (let index = 0; index < 16; index += 2)
      if (!open.includes(index))
        pattern.notes.push(
          createNote(
            42,
            step(index) + [0, 5, 7, 3, 0, 4, 8, 5][index / 2],
            62,
            [0.45, 0.25, 0.37, 0.27, 0.41, 0.23, 0.34, 0.21][index / 2],
          ),
        );
    for (const index of open)
      pattern.notes.push(createNote(46, step(index) + 5, 110, 0.29));
  };
  const intro = createPattern("drums", BAR);
  intro.name = "Rim & hats";
  intro.swing = swing;
  hats(intro);
  intro.notes.push(
    createNote(36, step(0), 100, 0.7),
    createNote(36, step(10), 100, 0.5),
    createNote(37, step(4) + 8, 90, 0.54),
    createNote(37, step(12) + 10, 90, 0.59),
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
    createNote(38, step(4) + 10, 110, 0.81),
    createNote(38, step(12) + 12, 110, 0.86),
    createNote(39, step(4) + 15, 90, 0.22),
    createNote(39, step(12) + 17, 90, 0.25),
    createNote(38, step(9) + 8, 75, 0.18),
    createNote(38, step(15) + 7, 75, 0.16),
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
    createNote(38, step(4) + 10, 110, 0.81),
    createNote(38, step(12) + 12, 110, 0.87),
    createNote(39, step(12) + 17, 90, 0.27),
    createNote(38, step(9) + 8, 75, 0.18),
    createNote(38, step(14), 80, 0.36),
    createNote(38, step(15), 80, 0.56),
    createNote(37, step(6), 80, 0.3),
  );

  const release = createPattern("drums", BAR);
  release.name = "Let it settle";
  release.swing = swing;
  release.notes.push(
    createNote(36, 0, 100, 0.72),
    createNote(37, step(4) + 8, 90, 0.43),
    ...[0, 2, 4, 6].map((index) =>
      createNote(
        42,
        step(index) + (index === 0 ? 0 : 5),
        62,
        0.3 - index * 0.018,
      ),
    ),
  );

  // Keys. The intro lets each chord ring; the comp answers the kick with a pushed second hit.
  const held = (name: string, chords: DemoChord[]) => {
    const pattern = createPattern("midi", BAR * 4);
    pattern.name = name;
    chords.forEach((chord, bar) => {
      // The intro has no bass track yet: a soft left-hand root makes each rootless
      // voicing read as its intended harmony rather than a different inversion.
      pattern.notes.push(
        createNote(DEMO_ROOTS[chord], bar * BAR, BAR - 180, 0.4),
        ...strum(chord, bar * BAR + 12, BAR - 120, 0.5, 16),
      );
    });
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
  const keysOutro = comp("Coming home · Cm9", cadence);
  keysOutro.notes = keysOutro.notes.filter((note) => note.startTick < BAR * 3);
  keysOutro.notes.push(...strum("Cm9", BAR * 3, BAR - 240, 0.51, 16));

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
        createNote(
          root + (chord === "G7alt" || bar % 2 ? 12 : 7),
          at + 1200,
          bar % 2 ? 180 : 300,
          0.7,
        ),
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
  const bassOutro = walk("Back to C", cadence, [31, 32, 35, 36]);
  bassOutro.notes = bassOutro.notes.filter((note) => note.startTick < BAR * 3);
  bassOutro.notes.push(createNote(36, BAR * 3, BAR - 300, 0.74));

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

  const padOutro = glow("The room, after", [
    [67, 74, 0, 1],
    [67, 72, 1, 1],
    [65, 71, 2, 1],
    [63, 67, 3, 1],
  ]);

  // The hook repeats a short rising gesture, leaves a breath, and answers it.
  // Altered-dominant bars use E♭/A♭/B, avoiding a sustained D rubbing against E♭.
  // The final C is a destination, so an exported excerpt sounds finished on its own.
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
    [72, BAR + 960, 420, 0.68],
    [70, BAR + 1440, 360, 0.6],
    [67, BAR * 2, 900, 0.7],
    [70, BAR * 2 + 1200, 220, 0.6],
    [74, BAR * 2 + 1440, 360, 0.66],
  ];
  const theme = line("Question", [
    ...question,
    [75, BAR * 3, 600, 0.76],
    [68, BAR * 3 + 720, 240, 0.6],
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
    [68, BAR * 3 + 720, 220, 0.6],
    [71, BAR * 3 + 960, 220, 0.64],
    [67, BAR * 3 + 1200, 660, 0.66],
  ]);
  const close = line("An answer, finally", [
    ...question.filter(([, tick]) => tick < BAR * 2),
    [75, BAR * 2, 480, 0.68],
    [68, BAR * 2 + 720, 220, 0.57],
    [71, BAR * 2 + 960, 600, 0.63],
    [72, BAR * 3, 1320, 0.67],
  ]);

  for (const pattern of [
    intro,
    groove,
    turn,
    release,
    keysIntro,
    keysHome,
    keysLift,
    keysOutro,
    bassHome,
    bassLift,
    bassOutro,
    padHome,
    padLift,
    padOutro,
    theme,
    answer,
    close,
  ])
    project.patterns[pattern.id] = pattern;

  const place = (
    pattern: Pattern,
    startBar: number,
    bars: number,
    gain = 1,
  ) => {
    const clip = createMidiClip(pattern, startBar * BAR);
    clip.durationTicks = bars * BAR;
    clip.gain = gain;
    return clip;
  };
  // Section gains build a small arc without an automation system or extra tracks.
  drums.clips.push(place(intro, 0, 4, 0.84));
  for (const section of [4, 8])
    drums.clips.push(
      place(groove, section, 3, section === 4 ? 0.94 : 1),
      place(turn, section + 3, 1, 0.94),
    );
  drums.clips.push(place(groove, 12, 3, 0.9), place(release, 15, 1, 0.86));
  keys.clips.push(
    place(keysIntro, 0, 4, 0.94),
    place(keysHome, 4, 4, 0.94),
    place(keysLift, 8, 4),
    place(keysOutro, 12, 4, 0.94),
  );
  bass.clips.push(
    place(bassHome, 4, 4, 0.94),
    place(bassLift, 8, 4),
    place(bassOutro, 12, 4, 0.94),
  );
  pad.clips.push(
    place(padHome, 0, 4, 0.7),
    place(padLift, 8, 4, 0.86),
    place(padOutro, 12, 4, 0.72),
  );
  hook.clips.push(
    place(theme, 4, 4, 0.9),
    place(answer, 8, 4),
    place(close, 12, 4, 0.84),
  );
  project.tracks = [drums, keys, bass, pad, hook];
  return project;
}
