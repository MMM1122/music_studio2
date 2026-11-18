import { ChevronLeft, ChevronRight } from "lucide-react";
import { DRUMS } from "../domain/models";
import { TYPING_DRUMS, TYPING_KEYS } from "../domain/recording";
import { noteName } from "../domain/theory";
import { pressNote, releaseNote, shiftOctave } from "../input/performance";
import { usePerformanceStore } from "../stores/performanceStore";
import "../themes/editors.css";

export interface KeyboardProps {
  octaves?: number;
  /** Spells key names for the song's key (E♭ rather than D♯ in C minor). */
  musicalKey?: string;
  /** Show the drum kit as pads instead of piano keys. */
  drums?: boolean;
}
const keyLetter = (code: string | undefined) =>
  code === "Semicolon" ? ";" : (code?.replace("Key", "") ?? "");
const BLACK = [1, 3, 6, 8, 10];

/** On-screen keys. Notes sound for as long as a key is held and are recorded like any other
 * input; the computer keyboard and MIDI keyboards light the same keys. */
export function Keyboard({ octaves = 2, musicalKey, drums }: KeyboardProps) {
  const octave = usePerformanceStore((state) => state.octave);
  const held = usePerformanceStore((state) => state.held);
  const typing = usePerformanceStore((state) => state.typing);
  const noteLabel = (pitch: number) => noteName(pitch, musicalKey);
  const start = (octave + 1) * 12;
  const notes = Array.from(
    { length: Math.max(1, Math.min(3, octaves)) * 12 + 1 },
    (_, i) => start + i,
  );
  const white = notes.filter((p) => !BLACK.includes(p % 12));
  const whiteWidth = 100 / white.length;
  /** Pointer and keyboard handlers shared by every key and pad. */
  const play = (pitch: number) => ({
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      // Capture keeps the release coming to this key even if the pointer slides off it.
      event.currentTarget.setPointerCapture?.(event.pointerId);
      pressNote(pitch);
    },
    onPointerUp: () => releaseNote(pitch),
    onPointerCancel: () => releaseNote(pitch),
    onLostPointerCapture: () => releaseNote(pitch),
    onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if ((event.key === "Enter" || event.key === " ") && !event.repeat) {
        event.preventDefault();
        event.stopPropagation();
        pressNote(pitch);
      }
    },
    onKeyUp: (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        releaseNote(pitch);
      }
    },
    onBlur: () => releaseNote(pitch),
  });
  const hint = (pitch: number) =>
    typing ? keyLetter(TYPING_KEYS[pitch - start]) : "";
  return (
    <div
      className="keyboard"
      aria-label={
        drums
          ? "Drum pads. Keys A S D F G H play the kit."
          : "Virtual piano keyboard. Keys A to L play notes; Z and X change octave."
      }
    >
      <div className="keyboard-octave">
        <span className="editor-tool-label">{drums ? "KIT" : "OCTAVE"}</span>
        {!drums && (
          <div>
            <button
              aria-label="Lower keyboard octave"
              disabled={octave <= 1}
              onClick={() => shiftOctave(-1)}
            >
              <ChevronLeft size={13} />
            </button>
            <span>C{octave}</span>
            <button
              aria-label="Higher keyboard octave"
              disabled={octave >= 6}
              onClick={() => shiftOctave(1)}
            >
              <ChevronRight size={13} />
            </button>
          </div>
        )}
        <small>
          {typing
            ? drums
              ? "Hold a pad, or A–H"
              : "Hold a key, or A–L"
            : "Hold a key to play"}
        </small>
      </div>
      {drums ? (
        <div className="keyboard-pads">
          {DRUMS.map((drum) => {
            const code = Object.entries(TYPING_DRUMS).find(
              ([, pitch]) => pitch === drum.pitch,
            )?.[0];
            return (
              <button
                key={drum.pitch}
                type="button"
                className={`drum-pad ${held.includes(drum.pitch) ? "is-active" : ""}`}
                aria-label={`Play ${drum.name}`}
                {...play(drum.pitch)}
              >
                <span>{drum.name}</span>
                <small>{typing ? keyLetter(code) : ""}</small>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="keyboard-keys">
          {white.map((pitch, i) => (
            <button
              key={pitch}
              type="button"
              className={`virtual-white ${held.includes(pitch) ? "is-active" : ""}`}
              style={{ left: `${i * whiteWidth}%`, width: `${whiteWidth}%` }}
              title={noteLabel(pitch)}
              aria-label={`Play ${noteLabel(pitch)}`}
              {...play(pitch)}
            >
              <span>{pitch % 12 === 0 ? noteLabel(pitch) : hint(pitch)}</span>
            </button>
          ))}
          {notes
            .filter((p) => BLACK.includes(p % 12))
            .map((pitch) => (
              <button
                key={pitch}
                type="button"
                className={`virtual-black ${held.includes(pitch) ? "is-active" : ""}`}
                style={{
                  left: `${(white.filter((p) => p < pitch).length - 0.31) * whiteWidth}%`,
                  width: `${whiteWidth * 0.62}%`,
                }}
                title={noteLabel(pitch)}
                aria-label={`Play ${noteLabel(pitch)}`}
                {...play(pitch)}
              >
                <span>{hint(pitch)}</span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
