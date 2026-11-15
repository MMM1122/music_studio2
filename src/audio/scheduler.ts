import { PPQ, type Project } from "../domain/models";
import { arrangementEnd } from "../domain/timing";
export { ticksToSeconds, secondsToTicks } from "../domain/timing";

export const arrangementEndTick = arrangementEnd;
export const isTrackAudible = (project: Project, trackId: string) => {
  const track = project.tracks.find((item) => item.id === trackId);
  return (
    !!track &&
    !track.mixer.mute &&
    (!project.tracks.some((item) => item.mixer.solo) || track.mixer.solo)
  );
};
interface EventBase {
  trackId: string;
  clipId: string;
  startTick: number;
  durationTicks: number;
  gain: number;
}
export interface NoteEvent extends EventBase {
  type: "note";
  pitch: number;
  velocity: number;
}
export interface SampleEvent extends EventBase {
  type: "audio";
  assetId: string;
  offsetSeconds: number;
  loop: boolean;
}
export type MusicalEvent = NoteEvent | SampleEvent;

/** Clip length is a hard musical gate; a looped MIDI clip repeats its shared pattern.
 * A non-looped clip plays the pattern once and remains silent when extended. */
export function collectEvents(project: Project): MusicalEvent[] {
  const events: MusicalEvent[] = [];
  for (const track of project.tracks)
    for (const clip of track.clips) {
      if (clip.durationTicks <= 0) continue;
      const base = { trackId: track.id, clipId: clip.id, gain: clip.gain };
      if (clip.type === "audio") {
        events.push({
          ...base,
          type: "audio",
          startTick: clip.startTick,
          durationTicks: clip.durationTicks,
          assetId: clip.assetId,
          offsetSeconds: clip.offsetSeconds,
          loop: clip.loop,
        });
        continue;
      }
      const pattern = project.patterns[clip.patternId];
      if (!pattern || pattern.lengthTicks <= 0) continue;
      const repetitions = clip.loop
        ? Math.ceil(clip.durationTicks / pattern.lengthTicks)
        : 1;
      for (let repetition = 0; repetition < repetitions; repetition++)
        for (const note of pattern.notes) {
          if (note.startTick >= pattern.lengthTicks || note.durationTicks <= 0)
            continue;
          // Swing only the off-beat sixteenths; the underlying pattern remains unchanged.
          const step = Math.floor(note.startTick / (PPQ / 4));
          const swingOffset =
            step % 2
              ? Math.round((Math.max(0, Math.min(1, pattern.swing)) * PPQ) / 8)
              : 0;
          const localTick =
            repetition * pattern.lengthTicks + note.startTick + swingOffset;
          if (localTick >= clip.durationTicks) continue;
          events.push({
            ...base,
            type: "note",
            startTick: clip.startTick + localTick,
            durationTicks: Math.min(
              note.durationTicks,
              clip.durationTicks - localTick,
              pattern.lengthTicks - note.startTick - swingOffset,
            ),
            pitch: note.pitch,
            velocity: note.velocity,
          });
        }
    }
  return events
    .filter((event) => event.durationTicks > 0)
    .sort((left, right) => left.startTick - right.startTick);
}

export function eventsCrossingTick(
  events: MusicalEvent[],
  tick: number,
): MusicalEvent[] {
  return events.filter(
    (event) =>
      event.startTick < tick && event.startTick + event.durationTicks > tick,
  );
}
