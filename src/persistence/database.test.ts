import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createDemoProject } from "../domain/factories";
import {
  deleteAsset,
  deleteProject,
  getAsset,
  listProjects,
  loadProject,
  missingAssets,
  saveAsset,
  saveProject,
} from "./database";

describe("IndexedDB project and asset persistence", () => {
  it("round-trips every domain field, preserves independent revisions and deletes a project", async () => {
    const project = createDemoProject();
    await saveProject(project);
    expect(await loadProject(project.id)).toEqual(project);
    project.transport.bpm = 97;
    project.tracks[0].effects.delay = 0.25;
    expect((await loadProject(project.id))?.transport.bpm).toBe(86);
    await saveProject(project);
    expect(await loadProject(project.id)).toEqual(project);
    expect((await listProjects()).some((p) => p.id === project.id)).toBe(true);
    await deleteProject(project.id);
    expect(await loadProject(project.id)).toBeUndefined();
  });
  it("rejects invalid saves without overwriting a valid project", async () => {
    const project = createDemoProject();
    await saveProject(project);
    project.transport.bpm = -1;
    await expect(saveProject(project)).rejects.toThrow();
    expect((await loadProject(project.id))?.transport.bpm).toBe(86);
    await deleteProject(project.id);
  });
  it("stores imported audio separately and reports missing referenced assets", async () => {
    const project = createDemoProject();
    const id = crypto.randomUUID();
    project.assets.push({
      id,
      name: "Original sound.wav",
      duration: 1,
      mimeType: "audio/wav",
      category: "One-shots",
    });
    expect(await missingAssets(project)).toEqual(["Original sound.wav"]);
    const bytes = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);
    await saveAsset(id, new Blob([bytes], { type: "audio/wav" }));
    const stored = await getAsset(id);
    expect(stored?.size).toBe(8);
    expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(bytes);
    expect(await missingAssets(project)).toEqual([]);
    await deleteAsset(id);
    expect(await getAsset(id)).toBeUndefined();
  });
});
