import { z } from "zod";
import { uid, type Project } from "../domain/models";
import { validateProject } from "../domain/validation";
import { getAsset, saveProjectBundle } from "./database";

const MAGIC = "STUDIO01";
const HEADER_BYTES = 12;
export const MAX_BACKUP_BYTES = 256 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const manifestSchema = z
  .object({
    format: z.literal("studio-complete-project"),
    version: z.literal(1),
    project: z.unknown(),
    assets: z
      .array(
        z
          .object({
            id: z.string().min(1).max(160),
            size: z.number().int().positive().max(MAX_BACKUP_BYTES),
            mimeType: z.string().max(200),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .max(2000),
  })
  .strict();

async function digest(blob: Blob): Promise<string> {
  if (!globalThis.crypto?.subtle)
    throw new Error(
      "Complete backups require a secure browser connection (HTTPS or localhost).",
    );
  const bytes = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(bytes)]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}

/** A bounded binary container: 8-byte magic, uint32 manifest length, JSON manifest,
 * then unmodified audio bytes. There is no ZIP expansion or base64 size overhead. */
export async function createProjectBackup(
  input: Project,
  readAsset: (id: string) => Promise<Blob | undefined> = getAsset,
): Promise<Blob> {
  const project = validateProject(structuredClone(input));
  const entries: z.infer<typeof manifestSchema>["assets"] = [];
  const blobs: Blob[] = [];
  let bytes = HEADER_BYTES;
  for (const asset of project.assets) {
    const blob = await readAsset(asset.id);
    if (!blob?.size)
      throw new Error(
        `Cannot create a complete backup: audio “${asset.name}” is missing. Re-import it first.`,
      );
    bytes += blob.size;
    if (bytes > MAX_BACKUP_BYTES)
      throw new Error("This project exceeds the 256 MB complete-backup limit.");
    entries.push({
      id: asset.id,
      size: blob.size,
      mimeType: blob.type || asset.mimeType,
      sha256: await digest(blob),
    });
    blobs.push(blob);
  }
  const manifest = new TextEncoder().encode(
    JSON.stringify({
      format: "studio-complete-project",
      version: 1,
      project,
      assets: entries,
    }),
  );
  if (
    manifest.byteLength > MAX_MANIFEST_BYTES ||
    bytes + manifest.byteLength > MAX_BACKUP_BYTES
  )
    throw new Error("This project exceeds the complete-backup size limit.");
  const header = new Uint8Array(HEADER_BYTES);
  header.set(new TextEncoder().encode(MAGIC));
  new DataView(header.buffer).setUint32(8, manifest.byteLength, true);
  return new Blob([header, manifest, ...blobs], {
    type: "application/octet-stream",
  });
}

export interface RestoredProjectBundle {
  project: Project;
  assets: Map<string, Blob>;
}

/** Validate metadata, exact lengths and every audio checksum before any storage write.
 * Restore as a new composition with new asset IDs, leaving the source session intact. */
export async function readProjectBackup(
  file: Blob,
): Promise<RestoredProjectBundle> {
  if (file.size < HEADER_BYTES || file.size > MAX_BACKUP_BYTES)
    throw new Error("Choose a complete STUDIO backup smaller than 256 MB.");
  const header = new Uint8Array(
    await file.slice(0, HEADER_BYTES).arrayBuffer(),
  );
  if (new TextDecoder().decode(header.subarray(0, 8)) !== MAGIC)
    throw new Error(
      "This is not a complete STUDIO backup. Use Import project JSON for a notes-only backup.",
    );
  const length = new DataView(header.buffer).getUint32(8, true);
  if (
    !length ||
    length > MAX_MANIFEST_BYTES ||
    HEADER_BYTES + length > file.size
  )
    throw new Error("The backup header is damaged or truncated.");
  let manifest: z.infer<typeof manifestSchema>;
  try {
    manifest = manifestSchema.parse(
      JSON.parse(await file.slice(HEADER_BYTES, HEADER_BYTES + length).text()),
    );
  } catch {
    throw new Error(
      "The backup metadata is invalid or uses an unsupported container version.",
    );
  }
  const project = validateProject(manifest.project);
  const expected = new Set(project.assets.map((asset) => asset.id));
  const seen = new Set<string>();
  let end = HEADER_BYTES + length;
  for (const asset of manifest.assets) {
    if (!expected.has(asset.id) || seen.has(asset.id))
      throw new Error("The backup audio inventory does not match its project.");
    seen.add(asset.id);
    end += asset.size;
  }
  if (seen.size !== expected.size || end !== file.size)
    throw new Error(
      "The backup is incomplete or contains unexpected audio bytes.",
    );
  const assets = new Map<string, Blob>();
  const remapped = new Map<string, string>();
  let offset = HEADER_BYTES + length;
  for (const entry of manifest.assets) {
    const blob = file.slice(offset, offset + entry.size, entry.mimeType);
    if ((await digest(blob)) !== entry.sha256)
      throw new Error(
        "An audio checksum failed. Nothing was imported; use an intact backup.",
      );
    offset += entry.size;
    const id = uid();
    remapped.set(entry.id, id);
    assets.set(id, blob);
  }
  project.id = uid();
  project.name = `${project.name.slice(0, 289)} (restored)`;
  project.createdAt = project.updatedAt = new Date().toISOString();
  project.assets = project.assets.map((asset) => ({
    ...asset,
    id: remapped.get(asset.id)!,
  }));
  for (const track of project.tracks)
    for (const clip of track.clips)
      if (clip.type === "audio") clip.assetId = remapped.get(clip.assetId)!;
  return { project: validateProject(project), assets };
}

export async function restoreProjectBackup(file: Blob): Promise<Project> {
  const restored = await readProjectBackup(file);
  await saveProjectBundle(restored.project, restored.assets);
  return restored.project;
}

export function downloadProjectFile(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  // Give downloads time to acquire the Blob before releasing the local URL.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
