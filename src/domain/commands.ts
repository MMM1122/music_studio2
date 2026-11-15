import {
  BAR,
  uid,
  type Clip,
  type MidiNote,
  type Pattern,
  type Project,
  type Track,
} from "./models";
import { clamp, snapTick } from "./timing";

/** Linked MIDI clip duplication deliberately preserves its pattern reference. */
export function duplicateClip(
  clip: Clip,
  startTick = clip.startTick + clip.durationTicks,
): Clip {
  return { ...clip, id: uid(), startTick };
}
export function duplicateNotes(
  notes: MidiNote[],
  offsetTicks = 480,
): MidiNote[] {
  return notes.map((note) => ({
    ...note,
    id: uid(),
    startTick: Math.max(0, note.startTick + offsetTicks),
  }));
}
export function duplicatePattern(pattern: Pattern): Pattern {
  return {
    ...pattern,
    id: uid(),
    name: `${pattern.name} copy`,
    notes: duplicateNotes(pattern.notes, 0),
  };
}
export function quantizeNotes(
  pattern: Pattern,
  ids: string[],
  resolution: number,
): void {
  const selected = new Set(ids);
  for (const note of pattern.notes) {
    if (selected.size && !selected.has(note.id)) continue;
    note.startTick = Math.min(
      Math.floor((pattern.lengthTicks - 1) / resolution) * resolution,
      snapTick(note.startTick, resolution),
    );
    note.durationTicks = Math.min(
      note.durationTicks,
      pattern.lengthTicks - note.startTick,
    );
  }
}
export function moveNotes(
  pattern: Pattern,
  ids: string[],
  deltaTicks: number,
  deltaPitch: number,
  resolution = 120,
): void {
  const selected = pattern.notes.filter((note) => ids.includes(note.id));
  if (!selected.length) return;
  const minStart = Math.min(...selected.map((note) => note.startTick));
  const maxEnd = Math.max(
    ...selected.map((note) => note.startTick + note.durationTicks),
  );
  const tickDelta = clamp(
    Math.round(deltaTicks / resolution) * resolution,
    -minStart,
    pattern.lengthTicks - maxEnd,
  );
  const pitchDelta = clamp(
    Math.round(deltaPitch),
    -Math.min(...selected.map((note) => note.pitch)),
    127 - Math.max(...selected.map((note) => note.pitch)),
  );
  for (const note of selected) {
    note.startTick += tickDelta;
    note.pitch += pitchDelta;
  }
}
export function resizeNote(
  pattern: Pattern,
  id: string,
  durationTicks: number,
  resolution = 120,
): void {
  const note = pattern.notes.find((n) => n.id === id);
  if (!note) return;
  note.durationTicks = clamp(
    snapTick(durationTicks, resolution),
    Math.min(resolution, pattern.lengthTicks - note.startTick),
    pattern.lengthTicks - note.startTick,
  );
}
export function resizeClip(
  clip: Clip,
  durationTicks: number,
  resolution = BAR,
): void {
  clip.durationTicks = Math.max(
    resolution,
    snapTick(durationTicks, resolution),
  );
}
export function moveClip(
  clip: Clip,
  startTick: number,
  resolution = BAR,
): void {
  clip.startTick = snapTick(startTick, resolution);
}
export function toggleDrumStep(
  pattern: Pattern,
  pitch: number,
  step: number,
  velocity = 0.8,
): void {
  const startTick = step * 120;
  if (startTick < 0 || startTick >= pattern.lengthTicks) return;
  const index = pattern.notes.findIndex(
    (note) => note.pitch === pitch && note.startTick === startTick,
  );
  if (index >= 0) pattern.notes.splice(index, 1);
  else
    pattern.notes.push({
      id: uid(),
      pitch,
      startTick,
      durationTicks: 100,
      velocity,
    });
}
export function removeUnusedPatterns(project: Project): void {
  const used = new Set(
    project.tracks.flatMap((track) =>
      track.clips.flatMap((clip) =>
        clip.type === "midi" ? [clip.patternId] : [],
      ),
    ),
  );
  for (const id of Object.keys(project.patterns))
    if (!used.has(id)) delete project.patterns[id];
}
export function audibleTracks(project: Project): Track[] {
  const anySolo = project.tracks.some((track) => track.mixer.solo);
  return project.tracks.filter(
    (track) => !track.mixer.mute && (!anySolo || track.mixer.solo),
  );
}
