import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Volume2 } from "lucide-react";
import { BAR, DRUMS, uid } from "../domain/models";
import type { MidiNote, Pattern } from "../domain/models";
import { editorTick, useTransportStore } from "../stores/transportStore";
import "../themes/editors.css";

export interface DrumSequencerProps {
  pattern: Pattern;
  onChange: (notes: MidiNote[], label: string) => void;
  onSwingChange: (swing: number) => void;
  onAudition: (pitch: number, velocity?: number) => void;
  /** Song position of the clip being edited, or null when editing a pattern on its own. */
  clipStart: number | null;
}
export function DrumSequencer({
  pattern,
  onChange,
  onSwingChange,
  onAudition,
  clipStart,
}: DrumSequencerProps) {
  const [bar, setBar] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [velocity, setVelocity] = useState(80);
  const [swing, setSwing] = useState(Math.round(pattern.swing * 100));
  const velocityDraft = useRef<number | null>(null);
  const swingDraft = useRef<number | null>(null);
  const barCount = Math.max(1, Math.ceil(pattern.lengthTicks / BAR));
  useEffect(() => {
    setBar(0);
    setSelected(null);
  }, [pattern.id]);
  useEffect(() => {
    setSwing(Math.round(pattern.swing * 100));
  }, [pattern.swing]);
  useEffect(() => {
    const note = pattern.notes.find((n) => n.id === selected);
    if (note) setVelocity(Math.round(note.velocity * 100));
  }, [selected, pattern.notes]);
  // Derived in the selector, so the grid re-renders once per step rather than once per frame.
  const activeStep = useTransportStore((readings) => {
    if (!readings.playing && !readings.previewing) return -1;
    const tick = editorTick(readings, pattern.lengthTicks, clipStart);
    return Math.floor(tick / BAR) === bar ? Math.floor((tick % BAR) / 120) : -1;
  });
  function toggle(pitch: number, step: number, selectOnly: boolean) {
    const startTick = bar * BAR + step * 120;
    const note = pattern.notes.find(
      (n) =>
        n.pitch === pitch && Math.floor(n.startTick / 120) === startTick / 120,
    );
    if (selectOnly && note) {
      setSelected(note.id);
      onAudition(pitch, note.velocity);
      return;
    }
    if (note) {
      onChange(
        pattern.notes.filter((n) => n.id !== note.id),
        "Remove drum hit",
      );
      setSelected(null);
    } else {
      const hit: MidiNote = {
        id: uid(),
        pitch,
        startTick,
        durationTicks: 120,
        velocity: velocity / 100,
      };
      onChange([...pattern.notes, hit], "Add drum hit");
      setSelected(hit.id);
      onAudition(pitch, hit.velocity);
    }
  }
  function commitVelocity() {
    if (velocityDraft.current === null) return;
    if (!selected) {
      velocityDraft.current = null;
      return;
    }
    const value = velocityDraft.current / 100;
    onChange(
      pattern.notes.map((n) =>
        n.id === selected ? { ...n, velocity: value } : n,
      ),
      "Change drum velocity",
    );
    velocityDraft.current = null;
  }
  function commitSwing() {
    if (swingDraft.current === null) return;
    onSwingChange(swingDraft.current / 100);
    swingDraft.current = null;
  }
  return (
    <div className="drum-editor" aria-label="Drum sequencer">
      <div className="drum-toolbar">
        <div className="editor-tool-group">
          <span className="editor-tool-label">16 STEPS</span>
          <span className="editor-small-separator" />
          <button
            className="editor-icon"
            onClick={() => setBar((b) => Math.max(0, b - 1))}
            disabled={bar === 0}
            aria-label="Previous pattern bar"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="tabular">
            Bar {bar + 1} / {barCount}
          </span>
          <button
            className="editor-icon"
            onClick={() => setBar((b) => Math.min(barCount - 1, b + 1))}
            disabled={bar + 1 >= barCount}
            aria-label="Next pattern bar"
          >
            <ChevronRight size={14} />
          </button>
        </div>
        <label className="drum-swing">
          <span className="editor-tool-label">SWING</span>
          <input
            type="range"
            min="0"
            max="100"
            value={swing}
            aria-label="Drum swing"
            onChange={(e) => {
              setSwing(Number(e.target.value));
              swingDraft.current = Number(e.target.value);
            }}
            onPointerUp={commitSwing}
            onKeyUp={commitSwing}
            onBlur={commitSwing}
          />
          <span className="tabular">{swing}%</span>
        </label>
      </div>
      <div className="drum-grid-scroll">
        <div className="drum-grid">
          <div className="drum-step-labels">
            <span>INSTRUMENT</span>
            {Array.from({ length: 16 }, (_, step) => (
              <span
                key={step}
                className={`${step % 4 === 0 ? "beat-start" : ""} ${activeStep === step ? "current-step" : ""}`}
              >
                {String(step + 1).padStart(2, "0")}
              </span>
            ))}
          </div>
          {DRUMS.map((drum, row) => (
            <div className="drum-row" key={drum.pitch}>
              <button
                className="drum-name"
                onClick={() => onAudition(drum.pitch, 0.8)}
                title={`Audition ${drum.name}`}
              >
                <span className="drum-number">
                  {String(row + 1).padStart(2, "0")}
                </span>
                <span>{drum.name}</span>
                <Volume2 size={12} />
              </button>
              {Array.from({ length: 16 }, (_, step) => {
                const note = pattern.notes.find(
                  (n) =>
                    n.pitch === drum.pitch &&
                    Math.floor(n.startTick / 120) === bar * 16 + step,
                );
                return (
                  <button
                    key={step}
                    type="button"
                    className={`drum-step ${step % 4 === 0 ? "beat-start" : ""} ${note ? "is-on" : ""} ${note && selected === note.id ? "is-selected" : ""} ${step === activeStep ? "is-playing" : ""}`}
                    aria-label={`${drum.name} step ${step + 1}${note ? ", on" : ", off"}`}
                    aria-pressed={Boolean(note)}
                    title={
                      note
                        ? `${drum.name} · velocity ${Math.round(note.velocity * 100)} · Alt-click to edit`
                        : `Add ${drum.name}`
                    }
                    onClick={(e) =>
                      toggle(drum.pitch, step, e.altKey || e.shiftKey)
                    }
                    onContextMenu={(e) => {
                      e.preventDefault();
                      if (note) {
                        setSelected(note.id);
                        onAudition(drum.pitch, note.velocity);
                      }
                    }}
                  >
                    <span
                      className="drum-step-fill"
                      style={{
                        opacity: note ? 0.35 + note.velocity * 0.65 : 0,
                      }}
                    />
                    {note && (
                      <span
                        className="drum-velocity-mark"
                        style={{
                          height: `${Math.max(12, note.velocity * 70)}%`,
                        }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="note-footer">
        <label className="velocity-control">
          <span className="editor-tool-label">VELOCITY</span>
          <input
            type="range"
            min="1"
            max="100"
            aria-label="Drum hit velocity"
            value={velocity}
            onChange={(e) => {
              setVelocity(Number(e.target.value));
              velocityDraft.current = Number(e.target.value);
            }}
            onPointerUp={commitVelocity}
            onKeyUp={commitVelocity}
            onBlur={commitVelocity}
          />
          <span className="tabular">{velocity}</span>
        </label>
        <span className="note-count">{pattern.notes.length} hits</span>
        <span className="editor-help">
          Click to toggle · Alt-click a hit to edit its velocity
        </span>
        <span className="scale-label">1/16 resolution</span>
      </div>
    </div>
  );
}
