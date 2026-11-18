import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createDemoProject, createTrack } from "../domain/factories";
import { uid } from "../domain/models";
import {
  createProjectBackup,
  readProjectBackup,
  restoreProjectBackup,
  MAX_BACKUP_BYTES,
} from "./backup";
import {
  saveAsset,
  saveProject,
  saveProjectBundle,
  getAsset,
  loadProject,
} from "./database";

function withAudio() {
  const project = createDemoProject();
  const assetId = uid();
  project.assets.push({
    id: assetId,
    name: "My original.wav",
    duration: 1,
    mimeType: "audio/wav",
    category: "Imported",
  });
  const track = createTrack("audio");
  track.clips.push({
    id: uid(),
    type: "audio",
    name: "Recorded phrase",
    startTick: 480,
    durationTicks: 960,
    loop: false,
    gain: 0.7,
    offsetSeconds: 0.1,
    assetId,
  });
  project.tracks.push(track);
  const blob = new Blob([new Uint8Array([82, 73, 70, 70, 4, 3, 2, 1])], {
    type: "audio/wav",
  });
  return { project, assetId, blob };
}

describe("complete project backups", () => {
  it("round-trips notes, Fourier settings and audio bytes as an independent project", async () => {
    const { project, assetId, blob } = withAudio();
    project.tracks[1].instrument = {
      type: "fourier",
      harmonics: [1, 0.2, 0, 0, 0, 0, 0, 0],
      presetName: "Personal keys",
      attack: 0.01,
      release: 0.4,
      brightness: 0.5,
    };
    const backup = await createProjectBackup(project, async (id) =>
      id === assetId ? blob : undefined,
    );
    const restored = await readProjectBackup(backup);
    expect(restored.project.id).not.toBe(project.id);
    expect(restored.project.name).toContain("(restored)");
    expect(restored.project.patterns).toEqual(project.patterns);
    expect(restored.project.tracks[1].instrument).toEqual(
      project.tracks[1].instrument,
    );
    const replacement = restored.project.assets[0].id;
    expect(replacement).not.toBe(assetId);
    const clip = restored.project.tracks.at(-1)!.clips[0];
    expect(clip.type === "audio" && clip.assetId).toBe(replacement);
    expect(await restored.assets.get(replacement)!.arrayBuffer()).toEqual(
      await blob.arrayBuffer(),
    );
    expect(project.assets[0].id).toBe(assetId);
    const second = await readProjectBackup(backup);
    expect(second.project.id).not.toBe(restored.project.id);
    expect(second.project.assets[0].id).not.toBe(replacement);
  });
  it("preserves reference role, source markers and tempo analysis through storage and complete backup", async () => {
    const { project, assetId, blob } = withAudio();
    const track = project.tracks.at(-1)!;
    track.role = "reference";
    track.reference = {
      markers: [{ id: uid(), label: "Intro", timeSeconds: 0.25 }],
      tempo: {
        bpm: 104,
        confidence: 0.72,
        alternatives: [52, 208],
        analyzedSeconds: 1,
      },
      manualBpm: 106,
    };
    await saveProject(project);
    await saveAsset(assetId, blob);
    expect((await loadProject(project.id))!.tracks.at(-1)!.reference).toEqual(
      track.reference,
    );
    const restored = await restoreProjectBackup(
      await createProjectBackup(project),
    );
    expect(restored.tracks.at(-1)!.role).toBe("reference");
    expect(restored.tracks.at(-1)!.reference).toEqual(track.reference);
    expect((await loadProject(restored.id))!.tracks.at(-1)!.reference).toEqual(
      track.reference,
    );
    expect((await getAsset(restored.assets[0].id))?.size).toBe(blob.size);
  });
  it("refuses to call an incomplete export a complete backup", async () => {
    const { project } = withAudio();
    await expect(
      createProjectBackup(project, async () => undefined),
    ).rejects.toThrow("missing");
  });
  it("rejects tampered or truncated audio before writing anything", async () => {
    const { project, assetId, blob } = withAudio();
    await saveProject(project);
    await saveAsset(assetId, blob);
    const backup = await createProjectBackup(project, async () => blob);
    const bytes = new Uint8Array(await backup.arrayBuffer());
    bytes[bytes.length - 1] ^= 1;
    await expect(restoreProjectBackup(new Blob([bytes]))).rejects.toThrow(
      "checksum",
    );
    await expect(readProjectBackup(backup.slice(0, -1))).rejects.toThrow(
      "incomplete",
    );
    expect(await loadProject(project.id)).toEqual(project);
    expect(await (await getAsset(assetId))!.arrayBuffer()).toEqual(
      await blob.arrayBuffer(),
    );
  });
  it("bounds input and rejects unknown headers, manifest versions and project versions", async () => {
    await expect(
      readProjectBackup(new Blob(["not a STUDIO backup"])),
    ).rejects.toThrow("not a complete");
    const huge = new Blob();
    Object.defineProperty(huge, "size", { value: MAX_BACKUP_BYTES + 1 });
    await expect(readProjectBackup(huge)).rejects.toThrow("256 MB");
    const make = (version: number, schemaVersion: number) => {
      const project = { ...createDemoProject(), schemaVersion };
      const metadata = new TextEncoder().encode(
        JSON.stringify({
          format: "studio-complete-project",
          version,
          project,
          assets: [],
        }),
      );
      const header = new Uint8Array(12);
      header.set(new TextEncoder().encode("STUDIO01"));
      new DataView(header.buffer).setUint32(8, metadata.length, true);
      return new Blob([header, metadata]);
    };
    await expect(readProjectBackup(make(2, 1))).rejects.toThrow(
      "unsupported container",
    );
    await expect(readProjectBackup(make(1, 2))).rejects.toThrow(
      "unsupported format",
    );
  });
  it("restores a whole backup without replacing its original saved project or audio", async () => {
    const { project, assetId, blob } = withAudio();
    await saveProject(project);
    await saveAsset(assetId, blob);
    const backup = await createProjectBackup(project);
    const restored = await restoreProjectBackup(backup);
    expect(await loadProject(restored.id)).toEqual(restored);
    expect(await loadProject(project.id)).toEqual(project);
    expect((await getAsset(restored.assets[0].id))?.size).toBe(blob.size);
    expect((await getAsset(assetId))?.size).toBe(blob.size);
  });
});

describe("atomic project and audio storage", () => {
  it("validates every asset before starting a storage write", async () => {
    const { project, assetId, blob } = withAudio();
    await expect(saveProjectBundle(project, new Map())).rejects.toThrow(
      "missing audio",
    );
    expect(await loadProject(project.id)).toBeUndefined();
    expect(await getAsset(assetId)).toBeUndefined();
    await saveProjectBundle(project, new Map([[assetId, blob]]));
    expect(await loadProject(project.id)).toEqual(project);
  });
  it("rolls back all writes if an audio ID collides, preserving old bytes", async () => {
    const { project, assetId, blob } = withAudio();
    const firstId = uid();
    project.assets.unshift({
      id: firstId,
      name: "First.wav",
      duration: 1,
      mimeType: "audio/wav",
      category: "Imported",
    });
    await saveAsset(assetId, blob);
    await expect(
      saveProjectBundle(
        project,
        new Map([
          [firstId, blob],
          [assetId, new Blob(["different audio"])],
        ]),
      ),
    ).rejects.toThrow("already exists");
    expect(await loadProject(project.id)).toBeUndefined();
    expect(await getAsset(firstId)).toBeUndefined();
    expect(await (await getAsset(assetId))!.arrayBuffer()).toEqual(
      await blob.arrayBuffer(),
    );
  });
  it("does not overwrite an existing project when its ID collides", async () => {
    const { project, assetId, blob } = withAudio();
    await saveProject(project);
    const changed = { ...project, name: "Overwrite attempt" };
    await expect(
      saveProjectBundle(changed, new Map([[assetId, blob]])),
    ).rejects.toThrow("already exists");
    expect((await loadProject(project.id))?.name).toBe(project.name);
    expect(await getAsset(assetId)).toBeUndefined();
  });
});
