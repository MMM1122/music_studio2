export const PPQ = 480;
export const BAR = PPQ * 4;
export const SCHEMA_VERSION = 1;
export type InstrumentType =
  | "electric-piano"
  | "synth-bass"
  | "synth-pad"
  | "lead-synth"
  | "drum-kit";
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
export interface Track {
  id: string;
  name: string;
  type: TrackType;
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
export const INSTRUMENTS: {
  type: InstrumentType;
  name: string;
  color: TrackColor;
}[] = [
  { type: "electric-piano", name: "Electric Piano", color: "mauve" },
  { type: "synth-bass", name: "Synth Bass", color: "slate" },
  { type: "synth-pad", name: "Synth Pad", color: "sage" },
  { type: "lead-synth", name: "Lead Synth", color: "sage" },
  { type: "drum-kit", name: "Drum Kit", color: "clay" },
];
export const uid = () => crypto.randomUUID();
