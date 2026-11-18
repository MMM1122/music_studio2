import { describe, expect, it } from "vitest";
import { createProject, createTrack } from "./factories";
import { uid, type AudioAsset } from "./models";
import { createReferenceTrack, rescaleReferenceClips } from "./reference";
import { ticksToSeconds } from "./timing";
import { validateProject } from "./validation";
import { useProjectStore } from "../stores/projectStore";

function referenceProject() {
  const project = createProject("Original composition");
  const asset: AudioAsset = {
    id: uid(),
    name: "Self-created reference",
    duration: 125.25,
    mimeType: "audio/wav",
    category: "Reference",
  };
  const track = createReferenceTrack(asset, project.transport.bpm);
  project.assets = [asset];
  project.tracks = [track];
  return { project, track, asset };
}

describe("reference track data and timing", () => {
  it("reuses an ordinary audio asset/clip with a distinct role and dry defaults", () => {
    const { project, track, asset } = referenceProject();
    expect(track.type).toBe("audio");
    expect(track.role).toBe("reference");
    expect(track.reference).toEqual({ markers: [] });
    expect(track.effects).toEqual({ reverb: 0, delay: 0, filter: 24000 });
    expect(track.mixer).toEqual({
      volume: 0.65,
      pan: 0,
      mute: false,
      solo: false,
    });
    expect(track.clips[0]).toMatchObject({
      type: "audio",
      assetId: asset.id,
      startTick: 0,
      offsetSeconds: 0,
      loop: false,
    });
    expect(
      ticksToSeconds(track.clips[0].durationTicks, project.transport.bpm),
    ).toBeCloseTo(asset.duration, 5);
    expect(validateProject(project)).toEqual(project);
  });

  it("keeps legacy schema-version-1 projects unchanged and preserves analysis JSON", () => {
    const legacy = createProject();
    legacy.tracks.push(createTrack("electric-piano"));
    expect(validateProject(legacy)).toEqual(legacy);
    const { project, track } = referenceProject();
    track.reference = {
      markers: [{ id: uid(), label: "Verse", timeSeconds: 24.5 }],
      tempo: {
        bpm: 96.4,
        confidence: 0.63,
        alternatives: [48.2, 192.8],
        analyzedSeconds: 125.25,
      },
      manualBpm: 96,
    };
    expect(validateProject(JSON.parse(JSON.stringify(project)))).toEqual(
      project,
    );
  });

  it("rejects reference roles on note tracks and reference data on ordinary audio", () => {
    const { project, track } = referenceProject();
    track.type = "midi";
    expect(() => validateProject(project)).toThrow(/only audio/);
    track.type = "audio";
    delete track.role;
    expect(() => validateProject(project)).toThrow(/requires a reference/);
  });

  it("bounds marker metadata and prevents ambiguous duplicate marker IDs", () => {
    const { project, track } = referenceProject();
    const marker = { id: uid(), label: "Intro", timeSeconds: 0 };
    track.reference = { markers: [marker, { ...marker, timeSeconds: 20 }] };
    expect(() => validateProject(project)).toThrow(/marker IDs/);
    track.reference.markers = [{ ...marker, timeSeconds: -1 }];
    expect(() => validateProject(project)).toThrow();
    track.reference.markers = [{ ...marker, label: " " }];
    expect(() => validateProject(project)).toThrow();
    track.reference.markers = [marker];
    track.reference.manualBpm = 0;
    expect(() => validateProject(project)).toThrow();
    delete track.reference.manualBpm;
    track.reference.tempo = {
      bpm: 120,
      confidence: 1.1,
      alternatives: [],
      analyzedSeconds: 40,
    };
    expect(() => validateProject(project)).toThrow();
  });

  it("preserves reference source seconds across tempo changes without moving normal audio clips", () => {
    const { project, track } = referenceProject();
    const clip = track.clips[0];
    if (clip.type !== "audio") throw Error("Audio clip required");
    clip.startTick = 9000;
    clip.durationTicks = 3601;
    clip.offsetSeconds = 3.75;
    track.reference!.markers = [
      { id: uid(), label: "Chorus", timeSeconds: 54.3 },
    ];
    const normal = createTrack("audio");
    normal.clips = [{ ...clip, id: uid() }];
    project.tracks.push(normal);
    const old = structuredClone(project);
    project.transport.bpm = 150;
    rescaleReferenceClips(project, old.transport.bpm);
    expect(ticksToSeconds(clip.startTick, 150)).toBeCloseTo(
      ticksToSeconds(old.tracks[0].clips[0].startTick, 90),
      3,
    );
    expect(ticksToSeconds(clip.durationTicks, 150)).toBeCloseTo(
      ticksToSeconds(old.tracks[0].clips[0].durationTicks, 90),
      3,
    );
    expect(clip.offsetSeconds).toBe(3.75);
    expect(track.reference).toEqual(old.tracks[0].reference);
    expect(normal.clips).toEqual(old.tracks[1].clips);
    const once = structuredClone(project);
    rescaleReferenceClips(project, 150);
    expect(project).toEqual(once);
  });

  it("applies tempo rebasing once and restores it through undo/redo", () => {
    const { project } = referenceProject();
    useProjectStore.getState().load(project);
    useProjectStore.getState().update("Set tempo", (draft) => {
      draft.transport.bpm = 135;
    });
    const changed = structuredClone(useProjectStore.getState().project);
    expect(changed.tracks[0].clips[0].durationTicks).toBe(
      Math.round(project.tracks[0].clips[0].durationTicks * 1.5),
    );
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().project.tracks).toEqual(project.tracks);
    expect(useProjectStore.getState().project.transport.bpm).toBe(90);
    useProjectStore.getState().redo();
    expect(useProjectStore.getState().project.tracks).toEqual(changed.tracks);
    expect(useProjectStore.getState().project.transport.bpm).toBe(135);
  });
});
