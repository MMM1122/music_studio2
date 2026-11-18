import { engine } from "../audio/engine";
import {
  applyTake,
  parseMidiMessage,
  typedPitch,
  type TakeNote,
} from "../domain/recording";
import { usePerformanceStore } from "../stores/performanceStore";
import { useProjectStore } from "../stores/projectStore";
import { useTransportStore } from "../stores/transportStore";

/** Live playing and recording. Every input — computer keys, a MIDI keyboard, the on-screen
 * keys — goes through `pressNote` and `releaseNote`, so they sound and record identically.
 * Nothing here schedules music: notes sound through the engine, and a finished take is
 * written to the project as one undoable edit. */

/** Pitch → the track it is sounding on (the selection can change while a key is down). */
const held = new Map<number, string>();
const recording = new Map<
  number,
  { startTick: number; velocity: number; trackId: string }
>();
let take: (TakeNote & { trackId: string })[] = [];
let report: (message: string) => void = () => {};

/** The selected instrument track. With an audio or reference track selected (for example just
 * after importing a song to play along with), notes go to the first instrument track instead. */
function playableTrack() {
  const { project, selectedTrackId } = useProjectStore.getState();
  const playable = project.tracks.filter((track) => track.type !== "audio");
  return (
    playable.find((track) => track.id === selectedTrackId) ??
    playable[0] ??
    null
  );
}
/** Song position of something the player just did, corrected for output latency. Just after
 * a loop wraps, the corrected position belongs to the end of the pass before. */
function playedTick(): number {
  const { transport } = useProjectStore.getState().project;
  let tick = engine.getTick() - engine.getLatencyTicks();
  if (transport.loop && tick < transport.loopStart)
    tick += transport.loopEnd - transport.loopStart;
  return Math.max(0, tick);
}
const publishHeld = () =>
  usePerformanceStore.setState({ held: [...held.keys()] });

export function pressNote(pitch: number, velocity = 0.8): void {
  const track = playableTrack();
  if (!track || held.has(pitch) || pitch < 0 || pitch > 127) return;
  held.set(pitch, track.id);
  publishHeld();
  void engine.noteOn(track, pitch, velocity).catch(() => {
    /* audio could not start; the key simply makes no sound */
  });
  if (usePerformanceStore.getState().armed && engine.isPlaying())
    recording.set(pitch, {
      startTick: playedTick(),
      velocity,
      trackId: track.id,
    });
}
export function releaseNote(pitch: number): void {
  const trackId = held.get(pitch);
  if (trackId === undefined) return;
  held.delete(pitch);
  publishHeld();
  engine.noteOff(trackId, pitch);
  const started = recording.get(pitch);
  if (started) {
    recording.delete(pitch);
    take.push({ pitch, ...started, endTick: playedTick() });
  }
}
export function releaseAll(): void {
  for (const pitch of [...held.keys()]) releaseNote(pitch);
}

/** Writes everything captured since recording began into the project. Called when playback
 * stops or recording is switched off; harmless when nothing was played. */
export function finishTake(): void {
  const now = playedTick();
  for (const [pitch, started] of recording)
    take.push({ pitch, ...started, endTick: now });
  recording.clear();
  if (!take.length) return;
  const notes = take;
  take = [];
  const store = useProjectStore.getState();
  const { transport } = store.project;
  const byTrack = new Map<string, TakeNote[]>();
  for (const { trackId, ...note } of notes) {
    // A note released after the loop wrapped ends where the loop does.
    if (note.endTick <= note.startTick)
      note.endTick = transport.loop ? transport.loopEnd : note.startTick + 120;
    byTrack.set(trackId, [...(byTrack.get(trackId) ?? []), note]);
  }
  let added = 0;
  let dropped = 0;
  let target: { trackId: string; clipId: string } | null = null;
  store.update("Record take", (draft) => {
    for (const [trackId, played] of byTrack) {
      const result = applyTake(draft, trackId, played);
      added += result.added;
      dropped += result.dropped;
      if (!target && result.clipId) target = { trackId, clipId: result.clipId };
    }
  });
  const selected = target as { trackId: string; clipId: string } | null;
  if (selected) store.selectClip(selected.trackId, selected.clipId);
  if (added || dropped)
    report(
      `Recorded ${added} ${added === 1 ? "note" : "notes"}.` +
        (dropped
          ? ` ${dropped} could not be placed: that part of the track is the unused end of a clip whose pattern is shared.`
          : " Undo removes the take."),
    );
}

export function setArmed(armed: boolean): void {
  usePerformanceStore.setState({ armed });
  if (!armed) finishTake();
}
export function setMetronome(on: boolean): void {
  usePerformanceStore.setState({ metronome: on });
  engine.setMetronome(on);
}
export function shiftOctave(delta: number): void {
  const { octave } = usePerformanceStore.getState();
  usePerformanceStore.setState({
    octave: Math.min(6, Math.max(1, octave + delta)),
  });
}

/** Asks the browser for MIDI inputs and plays every connected keyboard. Must be called from
 * a click: browsers show a permission prompt. */
export async function connectMidi(): Promise<void> {
  const set = usePerformanceStore.setState;
  if (typeof navigator.requestMIDIAccess !== "function") {
    set({ midi: "unsupported", midiDevices: [] });
    return;
  }
  set({ midi: "connecting" });
  try {
    const access = await navigator.requestMIDIAccess();
    const refresh = () => {
      const names: string[] = [];
      access.inputs.forEach((input) => {
        input.onmidimessage = (event) => {
          const message = parseMidiMessage(event.data);
          if (!message) return;
          if (message.type === "on")
            pressNote(message.pitch, Math.max(0.1, message.velocity));
          else releaseNote(message.pitch);
        };
        names.push(input.name || "MIDI input");
      });
      set({
        midi: names.length ? "connected" : "no-devices",
        midiDevices: names,
      });
    };
    access.onstatechange = refresh;
    refresh();
  } catch {
    set({ midi: "denied", midiDevices: [] });
  }
}

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  !!target.closest('input,textarea,select,[contenteditable="true"]');

/** Starts listening for computer-keyboard notes and for playback stopping. Returns a cleanup. */
export function startPerformance(
  notify: (message: string) => void,
): () => void {
  report = notify;
  engine.setMetronome(usePerformanceStore.getState().metronome);
  const codes = new Map<string, number>();
  const down = (event: KeyboardEvent) => {
    const state = usePerformanceStore.getState();
    if (
      state.suspended ||
      event.repeat ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      isEditable(event.target)
    )
      return;
    if (event.code === "KeyR") {
      event.preventDefault();
      setArmed(!state.armed);
      return;
    }
    if (!state.typing) return;
    if (event.code === "KeyZ" || event.code === "KeyX") {
      event.preventDefault();
      shiftOctave(event.code === "KeyZ" ? -1 : 1);
      return;
    }
    const track = playableTrack();
    if (!track) return;
    const pitch = typedPitch(event.code, state.octave, track.type === "drums");
    if (pitch === null) return;
    event.preventDefault();
    codes.set(event.code, pitch);
    pressNote(pitch);
  };
  const up = (event: KeyboardEvent) => {
    const pitch = codes.get(event.code);
    if (pitch === undefined) return;
    codes.delete(event.code);
    releaseNote(pitch);
  };
  const blur = () => {
    codes.clear();
    releaseAll();
  };
  window.addEventListener("keydown", down);
  window.addEventListener("keyup", up);
  window.addEventListener("blur", blur);
  // Playback ending, however it ends, closes the take.
  const unsubscribe = useTransportStore.subscribe((state, previous) => {
    if (previous.playing && !state.playing) finishTake();
  });
  return () => {
    window.removeEventListener("keydown", down);
    window.removeEventListener("keyup", up);
    window.removeEventListener("blur", blur);
    unsubscribe();
    releaseAll();
  };
}
