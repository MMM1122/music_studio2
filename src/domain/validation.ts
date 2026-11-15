import { z } from "zod";
import { INSTRUMENT_TYPES, type Pattern, type Project } from "./models";

const id = z.string().min(1).max(160);
const ticks = z
  .number()
  .int()
  .min(0)
  .max(480 * 4 * 4096);
const unit = z.number().min(0).max(1);
export const noteSchema = z.object({
  id,
  pitch: z.number().int().min(0).max(127),
  startTick: ticks,
  durationTicks: ticks.min(1),
  velocity: unit,
});
export const patternSchema = z
  .object({
    id,
    name: z.string().max(300),
    kind: z.enum(["midi", "drums"]),
    lengthTicks: ticks.min(1),
    notes: z.array(noteSchema).max(50000),
    swing: unit,
  })
  .superRefine((pattern, ctx) => {
    const ids = new Set<string>();
    for (const note of pattern.notes) {
      if (ids.has(note.id))
        ctx.addIssue({
          code: "custom",
          message: "Note IDs must be unique within a pattern.",
        });
      ids.add(note.id);
      if (
        note.startTick >= pattern.lengthTicks ||
        note.startTick + note.durationTicks > pattern.lengthTicks
      )
        ctx.addIssue({
          code: "custom",
          message: "Notes must fit inside their source pattern.",
        });
    }
  });
const instrumentSchema = z.object({
  type: z.enum(INSTRUMENT_TYPES),
  attack: z.number().min(0).max(10),
  release: z.number().min(0).max(30),
  brightness: unit,
});
const clipBase = {
  id,
  name: z.string().max(300),
  startTick: ticks,
  durationTicks: ticks.min(1),
  loop: z.boolean(),
  gain: z.number().min(0).max(2),
};
const clipSchema = z.discriminatedUnion("type", [
  z.object({ ...clipBase, type: z.literal("midi"), patternId: id }),
  z.object({
    ...clipBase,
    type: z.literal("audio"),
    assetId: id,
    offsetSeconds: z.number().min(0).max(86400),
  }),
]);
export const projectSchema = z
  .object({
    schemaVersion: z.literal(1),
    id,
    name: z.string().min(1).max(300),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    key: z.string().min(1).max(40),
    transport: z
      .object({
        bpm: z.number().min(30).max(300),
        timeSignature: z.tuple([z.literal(4), z.literal(4)]),
        loop: z.boolean(),
        loopStart: ticks,
        loopEnd: ticks.min(1),
      })
      .refine(
        (t) => t.loopEnd > t.loopStart,
        "Loop end must follow its start.",
      ),
    masterVolume: unit,
    tracks: z
      .array(
        z.object({
          id,
          name: z.string().max(300),
          type: z.enum(["midi", "drums", "audio"]),
          color: z.enum(["clay", "slate", "mauve", "sage", "taupe"]),
          instrument: instrumentSchema,
          mixer: z.object({
            volume: z.number().min(0).max(1.5),
            pan: z.number().min(-1).max(1),
            mute: z.boolean(),
            solo: z.boolean(),
          }),
          effects: z.object({
            reverb: unit,
            delay: unit,
            filter: z.number().min(20).max(24000),
          }),
          clips: z.array(clipSchema).max(10000),
        }),
      )
      .max(128),
    patterns: z.record(z.string(), patternSchema),
    assets: z
      .array(
        z.object({
          id,
          name: z.string().max(500),
          duration: z.number().min(0.001).max(86400),
          mimeType: z.string().max(200),
          category: z.string().max(100),
        }),
      )
      .max(2000),
  })
  .strict()
  .superRefine((project, ctx) => {
    const trackIds = new Set<string>();
    const clipIds = new Set<string>();
    const assets = new Set(project.assets.map((a) => a.id));
    if (assets.size !== project.assets.length)
      ctx.addIssue({
        code: "custom",
        message: "Audio asset IDs must be unique.",
      });
    for (const [id, pattern] of Object.entries(project.patterns))
      if (id !== pattern.id)
        ctx.addIssue({
          code: "custom",
          message: "Pattern keys must match their IDs.",
        });
    for (const track of project.tracks) {
      if (trackIds.has(track.id))
        ctx.addIssue({ code: "custom", message: "Track IDs must be unique." });
      trackIds.add(track.id);
      for (const clip of track.clips) {
        if (clipIds.has(clip.id))
          ctx.addIssue({ code: "custom", message: "Clip IDs must be unique." });
        clipIds.add(clip.id);
        if (
          clip.type === "midi" &&
          !Object.hasOwn(project.patterns, clip.patternId)
        )
          ctx.addIssue({
            code: "custom",
            message: `Clip ${clip.name} references a missing MIDI pattern.`,
          });
        if (clip.type === "audio" && !assets.has(clip.assetId))
          ctx.addIssue({
            code: "custom",
            message: `Clip ${clip.name} references a missing audio asset record.`,
          });
      }
    }
  });
export function validateProject(value: unknown): Project {
  if (
    typeof value === "object" &&
    value !== null &&
    "schemaVersion" in value &&
    value.schemaVersion !== 1
  )
    throw new Error(
      "This project uses an unsupported format version. Your stored data has not been changed.",
    );
  const result = projectSchema.safeParse(value);
  if (!result.success)
    throw new Error(
      `Cannot load project: ${result.error.issues[0]?.message ?? "invalid project data"}`,
    );
  return result.data;
}
export function validatePattern(value: unknown): Pattern {
  const result = patternSchema.safeParse(value);
  if (!result.success)
    throw new Error(
      `Invalid musical suggestion: ${result.error.issues[0]?.message ?? "invalid notes"}`,
    );
  return result.data;
}
