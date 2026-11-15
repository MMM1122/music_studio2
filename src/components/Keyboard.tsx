import { useState } from "react";
import type { KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { noteLabel } from "../domain/noteEditing";
import "../themes/editors.css";

export interface KeyboardProps {
  onAudition: (pitch: number) => void;
  octaves?: number;
}
const letters = [
  "a",
  "w",
  "s",
  "e",
  "d",
  "f",
  "t",
  "g",
  "y",
  "h",
  "u",
  "j",
  "k",
  "o",
  "l",
  "p",
];
export function Keyboard({ onAudition, octaves = 2 }: KeyboardProps) {
  const [octave, setOctave] = useState(3);
  const [active, setActive] = useState<number | null>(null);
  const start = (octave + 1) * 12;
  const notes = Array.from(
    { length: Math.max(1, Math.min(3, octaves)) * 12 + 1 },
    (_, i) => start + i,
  );
  const white = notes.filter((p) => ![1, 3, 6, 8, 10].includes(p % 12));
  const whiteWidth = 100 / white.length;
  function press(pitch: number) {
    setActive(pitch);
    onAudition(pitch);
  }
  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
    const index = letters.indexOf(event.key.toLowerCase());
    if (index >= 0) {
      event.preventDefault();
      event.stopPropagation();
      press(start + index);
    }
  }
  return (
    <div
      className="keyboard"
      tabIndex={0}
      aria-label="Virtual piano keyboard. Use A W S E D F T G Y H U J K to play."
      onKeyDown={keyboard}
      onKeyUp={() => setActive(null)}
      onBlur={() => setActive(null)}
    >
      <div className="keyboard-octave">
        <span className="editor-tool-label">OCTAVE</span>
        <div>
          <button
            aria-label="Lower keyboard octave"
            disabled={octave <= 1}
            onClick={() => setOctave((o) => o - 1)}
          >
            <ChevronLeft size={13} />
          </button>
          <span>C{octave}</span>
          <button
            aria-label="Higher keyboard octave"
            disabled={octave >= 6}
            onClick={() => setOctave((o) => o + 1)}
          >
            <ChevronRight size={13} />
          </button>
        </div>
        <small>Click or use A–K</small>
      </div>
      <div
        className="keyboard-keys"
        onPointerLeave={() => setActive(null)}
        onPointerUp={() => setActive(null)}
      >
        {white.map((pitch, i) => (
          <button
            key={pitch}
            type="button"
            className={`virtual-white ${active === pitch ? "is-active" : ""}`}
            style={{ left: `${i * whiteWidth}%`, width: `${whiteWidth}%` }}
            onPointerDown={() => press(pitch)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                press(pitch);
              }
            }}
            title={noteLabel(pitch)}
            aria-label={`Play ${noteLabel(pitch)}`}
          >
            <span>
              {pitch % 12 === 0
                ? noteLabel(pitch)
                : letters[pitch - start]?.toUpperCase()}
            </span>
          </button>
        ))}
        {notes
          .filter((p) => [1, 3, 6, 8, 10].includes(p % 12))
          .map((pitch) => (
            <button
              key={pitch}
              type="button"
              className={`virtual-black ${active === pitch ? "is-active" : ""}`}
              style={{
                left: `${(white.filter((p) => p < pitch).length - 0.31) * whiteWidth}%`,
                width: `${whiteWidth * 0.62}%`,
              }}
              onPointerDown={() => press(pitch)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  press(pitch);
                }
              }}
              title={noteLabel(pitch)}
              aria-label={`Play ${noteLabel(pitch)}`}
            >
              <span>{letters[pitch - start]?.toUpperCase()}</span>
            </button>
          ))}
      </div>
      <div className="keyboard-caption">
        <span>PLAY SOMETHING</span>
        <small>Every idea starts with a note.</small>
      </div>
    </div>
  );
}
