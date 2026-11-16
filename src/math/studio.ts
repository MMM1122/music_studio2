import {
  BAR,
  uid,
  type Instrument,
  type Pattern,
  type Project,
} from "../domain/models";
import {
  createMidiClip,
  createPattern,
  createTrack,
} from "../domain/factories";
import { validatePattern } from "../domain/validation";

/** Insert a detached copy using Studio's normal notes, tracks and clips. The caller
 * wraps this mutation in projectStore.update for one undoable operation. */
export function insertLabPattern(
  project: Project,
  source: Pattern,
  instrument: Instrument,
  atTick: number,
  previewBpm: number,
): { trackId: string; clipId: string } {
  const pattern = validatePattern(structuredClone(source));
  if (!pattern.notes.length)
    throw new Error("Add at least one note before sending it to Studio.");
  pattern.id = uid();
  pattern.notes = pattern.notes.map((note) => ({ ...note, id: uid() }));
  const track = createTrack(instrument.type);
  track.name = source.name;
  track.instrument = structuredClone(instrument);
  const start = Math.max(0, Math.floor(atTick / BAR) * BAR);
  const clip = createMidiClip(pattern, start);
  track.clips = [clip];
  if (!project.tracks.length)
    project.transport.bpm = Math.min(300, Math.max(30, previewBpm));
  project.patterns[pattern.id] = pattern;
  project.tracks.push(track);
  project.transport.loopEnd = Math.max(
    project.transport.loopEnd,
    Math.ceil((start + pattern.lengthTicks) / BAR) * BAR,
  );
  return { trackId: track.id, clipId: clip.id };
}

export function applyLabInstrument(
  project: Project,
  instrument: Instrument,
  trackId?: string,
): { trackId: string; clipId: string | null } {
  if (trackId) {
    const track = project.tracks.find((t) => t.id === trackId);
    if (!track || track.type !== "midi")
      throw new Error("Choose a melodic instrument track.");
    track.instrument = structuredClone(instrument);
    return { trackId, clipId: track.clips[0]?.id ?? null };
  }
  const track = createTrack(instrument.type);
  track.name = instrument.presetName || "Fourier Synth";
  track.instrument = structuredClone(instrument);
  const pattern = createPattern("midi", BAR * 2);
  pattern.name = track.name;
  const clip = createMidiClip(pattern);
  track.clips = [clip];
  project.patterns[pattern.id] = pattern;
  project.tracks.push(track);
  return { trackId: track.id, clipId: clip.id };
}
