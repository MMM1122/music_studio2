import { createTrack } from "./factories";
import { uid, type AudioAsset, type Project, type Track } from "./models";
import { secondsToTicks } from "./timing";

/** A reference reuses the regular audio clip/asset path, with dry routing and a
 * source-time analysis record. Audio bytes never become part of the project. */
export function createReferenceTrack(asset: AudioAsset, bpm: number): Track {
  const track = createTrack("audio");
  track.name = asset.name.slice(0, 300);
  track.role = "reference";
  track.reference = { markers: [] };
  track.color = "slate";
  track.mixer.volume = 0.65;
  track.effects = { reverb: 0, delay: 0, filter: 24000 };
  track.clips = [
    {
      id: uid(),
      type: "audio",
      name: track.name,
      assetId: asset.id,
      startTick: 0,
      durationTicks: Math.max(1, secondsToTicks(asset.duration, bpm)),
      loop: false,
      gain: 1,
      offsetSeconds: 0,
    },
  ];
  return track;
}

/** Mutates a project draft after a tempo edit. Reference clips keep their
 * absolute start and gate duration in seconds; ordinary clips keep beat timing.
 * Undo/redo restore complete snapshots, so they must not call this a second time.
 * Integer tick rounding introduces at most half a tick of timing error per edit. */
export function rescaleReferenceClips(
  project: Project,
  previousBpm: number,
): void {
  const bpm = project.transport.bpm;
  if (bpm === previousBpm) return;
  if (
    !Number.isFinite(bpm) ||
    !Number.isFinite(previousBpm) ||
    bpm <= 0 ||
    previousBpm <= 0
  )
    throw new Error("A tempo change requires a positive, finite BPM.");
  const ratio = bpm / previousBpm;
  for (const track of project.tracks) {
    if (track.role !== "reference") continue;
    for (const clip of track.clips) {
      if (clip.type !== "audio") continue;
      clip.startTick = Math.max(0, Math.round(clip.startTick * ratio));
      clip.durationTicks = Math.max(1, Math.round(clip.durationTicks * ratio));
    }
  }
}
