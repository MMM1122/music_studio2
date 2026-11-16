import { create } from "zustand";
import { z } from "zod";
import { createPattern } from "../domain/factories";
import { uid, type Instrument, type Pattern } from "../domain/models";
import { patternSchema } from "../domain/validation";
import {
  DEFAULT_FUNCTION_SETTINGS,
  generateFunction,
  type FunctionSettings,
} from "../math/functions";
import { makeFourierInstrument, FOURIER_PRESETS } from "../math/fourier";
import type { BayesContext, BayesModel } from "../math/bayesian";

export interface SavedHarmonicPreset {
  id: string;
  name: string;
  instrument: Instrument;
}
export interface LabData {
  workspace: "studio" | "math";
  tab: "functions" | "fourier" | "bayesian";
  functionSettings: FunctionSettings;
  functionPattern: Pattern;
  sound: "keys" | "fourier";
  fourier: Instrument;
  fourierVolume: number;
  savedPresets: SavedHarmonicPreset[];
  bayesContext: BayesContext;
  bayesModel: BayesModel;
  bayesPattern: Pattern;
  bayesLength: number;
  bayesBpm: number;
  exploration: number;
  seed: number;
}
interface LabStore extends LabData {
  storageError: string;
  patch: (patch: Partial<LabData>) => void;
  setWorkspace: (workspace: LabData["workspace"]) => void;
  setTab: (tab: LabData["tab"]) => void;
  savePreset: (name: string, instrument: Instrument) => void;
}
const KEY = "studio.math-lab.v1";
const scaleSchema = z.enum(["major", "minor", "pentatonic"]);
const contextSchema = z.object({
  root: z.number().int().min(0).max(11),
  scale: scaleSchema,
  chord: z.number().int().min(0).max(6),
  previous: z.number().int().min(0).max(6),
});
const unit = z.number().min(0).max(1);
const fourierSchema = z.object({
  type: z.literal("fourier"),
  attack: z.number().min(0).max(10),
  release: z.number().min(0).max(30),
  brightness: unit,
  harmonics: z.array(unit).length(8),
  presetName: z.string().max(80).optional(),
});
const labPattern = patternSchema.refine(
  (p) => p.kind === "midi" && p.notes.length <= 128 && p.lengthTicks <= 15360,
);
const dataSchema = z.object({
  workspace: z.enum(["studio", "math"]),
  tab: z.enum(["functions", "fourier", "bayesian"]),
  functionSettings: z.object({
    root: z.number().int().min(0).max(11),
    scale: scaleSchema,
    octave: z.number().int().min(1).max(6),
    octaves: z.number().int().min(1).max(3),
    bpm: z.number().min(30).max(300),
    expression: z.string().max(256),
    amplitude: z.number().min(0).max(2),
    frequency: z.number().min(0.25).max(8),
    offset: z.number().min(-1).max(1),
    velocityMapping: z.boolean(),
    density: z.boolean(),
  }),
  functionPattern: labPattern,
  sound: z.enum(["keys", "fourier"]),
  fourier: fourierSchema,
  fourierVolume: unit,
  savedPresets: z
    .array(
      z.object({
        id: z.string().max(160),
        name: z.string().min(1).max(80),
        instrument: fourierSchema,
      }),
    )
    .max(24),
  bayesContext: contextSchema,
  bayesModel: z
    .record(
      z.string().max(80),
      z.object({
        accepted: z.array(z.number().int().min(0).max(1000000)).min(5).max(7),
        rejected: z.array(z.number().int().min(0).max(1000000)).min(5).max(7),
      }),
    )
    .refine((m) => Object.keys(m).length <= 1000),
  bayesPattern: labPattern,
  bayesLength: z.union([z.literal(8), z.literal(16), z.literal(32)]),
  bayesBpm: z.number().min(30).max(300),
  exploration: unit,
  seed: z.number().int().min(0).max(2147483647),
});
function defaults(): LabData {
  const preset = FOURIER_PRESETS[1] ?? FOURIER_PRESETS[0];
  return {
    workspace: "studio",
    tab: "functions",
    functionSettings: { ...DEFAULT_FUNCTION_SETTINGS },
    functionPattern: generateFunction(DEFAULT_FUNCTION_SETTINGS).pattern,
    sound: "keys",
    fourier: makeFourierInstrument(
      preset.harmonics,
      preset.name,
      preset.attack,
      preset.release,
    ),
    fourierVolume: 0.5,
    savedPresets: [],
    bayesContext: { root: 2, scale: "minor", chord: 0, previous: 0 },
    bayesModel: {},
    bayesPattern: { ...createPattern("midi", 3840), name: "Bayesian melody" },
    bayesLength: 16,
    bayesBpm: 80,
    exploration: 0.15,
    seed: 1,
  };
}
export function recoverLabState(raw: string | null): LabData {
  if (!raw) return defaults();
  try {
    if (raw.length > 1_000_000) return defaults();
    const parsed = JSON.parse(raw);
    if (parsed.version !== 1) return defaults();
    const checked = dataSchema.safeParse(parsed.data);
    if (!checked.success) return defaults();
    const d = checked.data;
    if (
      d.bayesContext.scale === "pentatonic" &&
      (d.bayesContext.previous > 4 || d.bayesContext.chord > 4)
    )
      return defaults();
    return d;
  } catch {
    return defaults();
  }
}
function load(): LabData {
  try {
    return recoverLabState(localStorage.getItem(KEY));
  } catch {
    return defaults();
  }
}
function persist(data: LabData): string {
  try {
    localStorage.setItem(KEY, JSON.stringify({ version: 1, data }));
    return "";
  } catch {
    return "Local saving is unavailable. Keep this tab open; add your music to Studio and export a project backup.";
  }
}
export const useMathLabStore = create<LabStore>((set, get) => ({
  ...load(),
  storageError: "",
  patch: (patch) =>
    set((state) => {
      const next = { ...state, ...patch };
      return { ...patch, storageError: persist(next) };
    }),
  setWorkspace: (workspace) => get().patch({ workspace }),
  setTab: (tab) => get().patch({ tab }),
  savePreset: (name, instrument) => {
    const clean = name.trim().slice(0, 80);
    if (!clean) return;
    const state = get();
    const existing = state.savedPresets.find((p) => p.name === clean);
    const preset = {
      id: existing?.id ?? uid(),
      name: clean,
      instrument: structuredClone({ ...instrument, presetName: clean }),
    };
    const savedPresets = existing
      ? state.savedPresets.map((p) => (p.id === existing.id ? preset : p))
      : [...state.savedPresets.slice(-23), preset];
    state.patch({ savedPresets });
  },
}));
