export const PPQ = 480;
export const BAR = PPQ * 4;
export const SCHEMA_VERSION = 1;
export type InstrumentType =
  | "electric-piano"
  | "felt-piano"
  | "synth-bass"
  | "sub-bass"
  | "synth-pad"
  | "lead-synth"
  | "pluck"
  | "drum-kit"
  | "fourier";
export const INSTRUMENT_TYPES = [
  "electric-piano",
  "felt-piano",
  "synth-bass",
  "sub-bass",
  "synth-pad",
  "lead-synth",
  "pluck",
  "drum-kit",
  "fourier",
] as const satisfies readonly InstrumentType[];
export type TrackType = "midi" | "drums" | "audio";
export type TrackColor = "clay" | "slate" | "mauve" | "sage" | "taupe";
export interface MidiNote {
  id: string;
  pitch: number;
  startTick: number;
  durationTicks: number;
  velocity: number;
}
export interface Pattern {
  id: string;
  name: string;
  lengthTicks: number;
  kind: "midi" | "drums";
  notes: MidiNote[];
  swing: number;
}
export interface Instrument {
  harmonics?: number[];
  presetName?: string;
  type: InstrumentType;
  attack: number;
  release: number;
  brightness: number;
}
export interface Effect {
  reverb: number;
  delay: number;
  filter: number;
}
export interface MixerSettings {
  volume: number;
  pan: number;
  mute: boolean;
  solo: boolean;
}
export interface ReferenceMarker {
  id: string;
  label: string;
  /** Timestamp in the original audio source, independent of project tempo. */
  timeSeconds: number;
}
export interface ReferenceTempo {
  bpm: number;
  confidence: number;
  alternatives: number[];
  analyzedSeconds: number;
}
export interface ReferenceInfo {
  markers: ReferenceMarker[];
  tempo?: ReferenceTempo;
  manualBpm?: number;
}
export interface Track {
  id: string;
  name: string;
  type: TrackType;
  role?: "reference";
  reference?: ReferenceInfo;
  color: TrackColor;
  instrument: Instrument;
  mixer: MixerSettings;
  effects: Effect;
  clips: Clip[];
}
export interface ClipBase {
  id: string;
  name: string;
  startTick: number;
  durationTicks: number;
  loop: boolean;
  gain: number;
}
export interface MidiClip extends ClipBase {
  type: "midi";
  patternId: string;
}
export interface AudioClip extends ClipBase {
  type: "audio";
  assetId: string;
  offsetSeconds: number;
}
export type Clip = MidiClip | AudioClip;
export interface TransportSettings {
  bpm: number;
  timeSignature: [number, number];
  loop: boolean;
  loopStart: number;
  loopEnd: number;
}
export interface AudioAsset {
  id: string;
  name: string;
  duration: number;
  mimeType: string;
  category: string;
}
export interface Project {
  schemaVersion: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  key: string;
  transport: TransportSettings;
  masterVolume: number;
  tracks: Track[];
  patterns: Record<string, Pattern>;
  assets: AudioAsset[];
}
export const DRUMS = [
  { name: "Kick", pitch: 36 },
  { name: "Snare", pitch: 38 },
  { name: "Closed hat", pitch: 42 },
  { name: "Open hat", pitch: 46 },
  { name: "Clap", pitch: 39 },
  { name: "Percussion", pitch: 37 },
] as const;
export interface InstrumentPreset {
  type: InstrumentType;
  name: string;
  color: TrackColor;
  description: string;
  /** Starting sound and mix for a new track, chosen so presets sit together without tweaking. */
  attack: number;
  release: number;
  brightness: number;
  volume: number;
  reverb: number;
  delay: number;
}
export const INSTRUMENTS: InstrumentPreset[] = [
  {
    type: "electric-piano",
    name: "Electric Piano",
    color: "mauve",
    description: "Warm, rounded, and full of soul",
    attack: 0.004,
    release: 0.4,
    brightness: 0.5,
    volume: 0.68,
    reverb: 0.2,
    delay: 0,
  },
  {
    type: "felt-piano",
    name: "Felt Piano",
    color: "mauve",
    description: "Close, muted keys for late-night chords",
    attack: 0.006,
    release: 0.55,
    brightness: 0.45,
    volume: 0.7,
    reverb: 0.26,
    delay: 0,
  },
  {
    type: "synth-bass",
    name: "Synth Bass",
    color: "slate",
    description: "A soft foundation for your groove",
    attack: 0.004,
    release: 0.12,
    brightness: 0.45,
    volume: 0.7,
    reverb: 0.02,
    delay: 0,
  },
  {
    type: "sub-bass",
    name: "Sub Bass",
    color: "slate",
    description: "Deep, long notes that hold the floor",
    attack: 0.005,
    release: 0.2,
    brightness: 0.4,
    volume: 0.7,
    reverb: 0,
    delay: 0,
  },
  {
    type: "synth-pad",
    name: "Synth Pad",
    color: "sage",
    description: "Slow-moving space and atmosphere",
    attack: 0.35,
    release: 1.1,
    brightness: 0.45,
    volume: 0.5,
    reverb: 0.4,
    delay: 0,
  },
  {
    type: "lead-synth",
    name: "Lead Synth",
    color: "sage",
    description: "A melody with something to say",
    attack: 0.012,
    release: 0.3,
    brightness: 0.5,
    volume: 0.56,
    reverb: 0.22,
    delay: 0.18,
  },
  {
    type: "pluck",
    name: "Pluck",
    color: "taupe",
    description: "Short, bright notes for arpeggios and hooks",
    attack: 0.003,
    release: 0.3,
    brightness: 0.55,
    volume: 0.6,
    reverb: 0.24,
    delay: 0.22,
  },
  {
    type: "drum-kit",
    name: "Drum Kit",
    color: "clay",
    description: "Six original synthesized drum voices",
    attack: 0.005,
    release: 0.35,
    brightness: 0.55,
    volume: 0.72,
    reverb: 0.06,
    delay: 0,
  },
  {
    type: "fourier",
    name: "Fourier Synth",
    color: "slate",
    description: "Eight harmonics, your own sound",
    attack: 0.015,
    release: 0.3,
    brightness: 0.5,
    volume: 0.65,
    reverb: 0.1,
    delay: 0,
  },
];
export const uid = () => crypto.randomUUID();
