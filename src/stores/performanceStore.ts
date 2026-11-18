import { create } from "zustand";
import { readPreference, writePreference } from "../persistence/database";

export type MidiStatus =
  | "off"
  | "connecting"
  | "connected"
  | "no-devices"
  | "denied"
  | "unsupported";
/** How the user is playing notes in right now. Preferences persist; held notes do not. */
export interface PerformanceState {
  /** The computer keyboard plays notes on the selected track. */
  typing: boolean;
  /** Octave of the lowest key on the on-screen and computer keyboards (C3 = 3). */
  octave: number;
  /** Pitches currently held, from any input, for key highlighting. */
  held: number[];
  /** Record what is played into the selected track while the song plays. */
  armed: boolean;
  metronome: boolean;
  midi: MidiStatus;
  midiDevices: string[];
  /** True while a dialog or another workspace owns the keyboard. */
  suspended: boolean;
}
const storedOctave = Number(readPreference("keyboard-octave"));
export const usePerformanceStore = create<PerformanceState>(() => ({
  typing: readPreference("keyboard-typing") !== "off",
  octave:
    Number.isInteger(storedOctave) && storedOctave >= 1 && storedOctave <= 6
      ? storedOctave
      : 3,
  held: [],
  armed: false,
  metronome: readPreference("metronome") === "on",
  midi: "off",
  midiDevices: [],
  suspended: false,
}));
usePerformanceStore.subscribe((state, previous) => {
  if (state.typing !== previous.typing)
    writePreference("keyboard-typing", state.typing ? "on" : "off");
  if (state.octave !== previous.octave)
    writePreference("keyboard-octave", String(state.octave));
  if (state.metronome !== previous.metronome)
    writePreference("metronome", state.metronome ? "on" : "off");
});
