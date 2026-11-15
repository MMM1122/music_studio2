import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";
import { Copy, CopyPlus, Minus, Plus, Scissors, Trash2 } from "lucide-react";
import { BAR, PPQ, uid } from "../domain/models";
import type { MidiNote, Pattern } from "../domain/models";
import {
  buildEditorChord,
  createEditedNote,
  duplicateSelectedNotes,
  moveSelectedNotes,
  quantizeSelectedNotes,
  resizeEditedNote,
  snapNoteTick,
} from "../domain/noteEditing";
import {
  CHORD_LABELS,
  chordSymbol,
  diatonicChords,
  noteName,
  pitchClassName,
  scalePitchClasses,
  type ChordQuality,
} from "../domain/theory";
import type { VoicingStyle } from "../domain/harmony";
import {
  editorTick,
  useTransportDraw,
  useTransportStore,
} from "../stores/transportStore";
import "../themes/editors.css";

export interface PianoRollProps {
  pattern: Pattern;
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
  onChange: (notes: MidiNote[], label: string) => void;
  onAudition: (pitch: number, velocity?: number) => void;
  musicalKey: string;
  /** Song position of the clip being edited, or null when editing a pattern on its own. */
  clipStart: number | null;
}
const ROW = 18;
const LOW = 0;
const HIGH = 127;
const KEY_WIDTH = 54;
const pitches = Array.from({ length: HIGH - LOW + 1 }, (_, i) => HIGH - i);
type Drag = {
  mode: "move" | "resize";
  x: number;
  y: number;
  note: MidiNote;
  ids: string[];
  original: MidiNote[];
  changed: boolean;
};
type SelectionBox = { x: number; y: number; endX: number; endY: number };

export function PianoRoll({
  pattern,
  selectedIds,
  onSelect,
  onChange,
  onAudition,
  musicalKey,
  clipStart,
}: PianoRollProps) {
  const [snap, setSnap] = useState(120);
  const [zoom, setZoom] = useState(1);
  const [draft, setDraft] = useState<MidiNote[] | null>(null);
  const [box, setBox] = useState<SelectionBox | null>(null);
  const [chord, setChord] = useState<ChordQuality>("min7");
  const [chordRoot, setChordRoot] = useState(60);
  const [voicing, setVoicing] = useState<VoicingStyle>("close");
  const [notice, setNotice] = useState(
    "Click to draw · drag to move · right edge to resize",
  );
  const wrapper = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const boxRef = useRef<SelectionBox | null>(null);
  const draftRef = useRef<MidiNote[] | null>(null);
  const clipboard = useRef<MidiNote[]>([]);
  const selectionVelocity = useRef<number | null>(null);
  const [velocity, setVelocity] = useState(78);
  const pixelsPerTick =
    (Math.max(56, (560 * PPQ) / pattern.lengthTicks) * zoom) / PPQ;
  const gridWidth = pattern.lengthTicks * pixelsPerTick;
  const scale = useMemo(() => scalePitchClasses(musicalKey), [musicalKey]);
  const keyChords = useMemo(() => diatonicChords(musicalKey), [musicalKey]);
  const noteLabel = (pitch: number) => noteName(pitch, musicalKey);
  const playheadRef = useRef<HTMLDivElement>(null);
  const currentTick = () =>
    editorTick(useTransportStore.getState(), pattern.lengthTicks, clipStart);
  const visibleNotes = draft ?? pattern.notes;
  const selected = pattern.notes.filter((n) => selectedIds.includes(n.id));
  useEffect(() => {
    setDraft(null);
    draftRef.current = null;
    drag.current = null;
    const average = pattern.notes.length
      ? pattern.notes.reduce((sum, n) => sum + n.pitch, 0) /
        pattern.notes.length
      : 60;
    if (scroller.current)
      scroller.current.scrollTop = Math.max(0, (HIGH - average) * ROW - 94);
    // Keep manual scrolling when editing the same pattern.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pattern.id]);
  useEffect(() => {
    const ns = pattern.notes.filter((n) => selectedIds.includes(n.id));
    if (ns.length)
      setVelocity(
        Math.round(
          (ns.reduce((sum, n) => sum + n.velocity, 0) / ns.length) * 100,
        ),
      );
  }, [pattern.notes, selectedIds]);

  function removeSelected() {
    if (!selectedIds.length) return;
    onChange(
      pattern.notes.filter((n) => !selectedIds.includes(n.id)),
      "Delete notes",
    );
    onSelect([]);
  }
  function duplicate() {
    const result = duplicateSelectedNotes(
      pattern.notes,
      selectedIds,
      pattern.lengthTicks,
      snap,
    );
    if (result.ids.length) {
      onChange(result.notes, "Duplicate notes");
      onSelect(result.ids);
    } else
      setNotice(
        "No space after this selection. Move it earlier or extend the pattern.",
      );
  }
  function copy() {
    clipboard.current = selected.map((n) => ({ ...n }));
    setNotice(
      `${selected.length} note${selected.length === 1 ? "" : "s"} copied · paste at the playhead`,
    );
  }
  function paste() {
    if (!clipboard.current.length) return;
    const min = Math.min(...clipboard.current.map((n) => n.startTick));
    const max = Math.max(
      ...clipboard.current.map((n) => n.startTick + n.durationTicks),
    );
    const start = Math.max(
      0,
      Math.min(
        pattern.lengthTicks - (max - min),
        snapNoteTick(currentTick(), snap),
      ),
    );
    const copies = clipboard.current.map((n) => ({
      ...n,
      id: uid(),
      startTick: start + n.startTick - min,
    }));
    onChange([...pattern.notes, ...copies], "Paste notes");
    onSelect(copies.map((n) => n.id));
  }
  function onKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (
      (event.target as HTMLElement).matches(
        'input, select, textarea, [contenteditable="true"]',
      )
    )
      return;
    const command = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (key === "delete" || key === "backspace") {
      event.preventDefault();
      event.stopPropagation();
      removeSelected();
    } else if (command && key === "a") {
      event.preventDefault();
      event.stopPropagation();
      onSelect(pattern.notes.map((n) => n.id));
    } else if (command && key === "d") {
      event.preventDefault();
      event.stopPropagation();
      duplicate();
    } else if (command && key === "c") {
      event.preventDefault();
      event.stopPropagation();
      copy();
    } else if (command && key === "v") {
      event.preventDefault();
      event.stopPropagation();
      paste();
    } else if (key === "escape") {
      event.stopPropagation();
      onSelect([]);
    } else if (key.startsWith("arrow") && selectedIds.length) {
      event.preventDefault();
      event.stopPropagation();
      const delta =
        key === "arrowright" ? snap : key === "arrowleft" ? -snap : 0;
      const pitch =
        key === "arrowup"
          ? event.shiftKey
            ? 12
            : 1
          : key === "arrowdown"
            ? event.shiftKey
              ? -12
              : -1
            : 0;
      onChange(
        moveSelectedNotes(
          pattern.notes,
          selectedIds,
          delta,
          pitch,
          pattern.lengthTicks,
        ),
        "Nudge notes",
      );
    }
  }
  function pointerPosition(event: PointerEvent) {
    const rect = grid.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(gridWidth, event.clientX - rect.left)),
      y: Math.max(0, Math.min(pitches.length * ROW, event.clientY - rect.top)),
    };
  }
  function blankDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    wrapper.current?.focus({ preventScroll: true });
    const pos = pointerPosition(event);
    if (event.shiftKey) {
      const selection = { ...pos, endX: pos.x, endY: pos.y };
      boxRef.current = selection;
      setBox(selection);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    const pitch = HIGH - Math.floor(pos.y / ROW);
    const note = createEditedNote(
      pitch,
      Math.floor(pos.x / pixelsPerTick / snap) * snap,
      snap,
      pattern.lengthTicks,
    );
    onChange([...pattern.notes, note], "Draw note");
    onSelect([note.id]);
    onAudition(note.pitch, note.velocity);
  }
  function noteDown(
    event: PointerEvent<HTMLButtonElement>,
    note: MidiNote,
    resize = false,
  ) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    wrapper.current?.focus({ preventScroll: true });
    let ids = selectedIds.includes(note.id) ? selectedIds : [note.id];
    if (event.shiftKey && !resize) {
      ids = selectedIds.includes(note.id)
        ? selectedIds.filter((id) => id !== note.id)
        : [...selectedIds, note.id];
      onSelect(ids);
      return;
    }
    onSelect(ids);
    onAudition(note.pitch, note.velocity);
    drag.current = {
      mode: resize ? "resize" : "move",
      x: event.clientX,
      y: event.clientY,
      note,
      ids,
      original: pattern.notes,
      changed: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function pointerMove(event: PointerEvent) {
    if (boxRef.current) {
      const pos = pointerPosition(event);
      boxRef.current = { ...boxRef.current, endX: pos.x, endY: pos.y };
      setBox(boxRef.current);
      return;
    }
    const d = drag.current;
    if (!d) return;
    const deltaTick =
      Math.round((event.clientX - d.x) / pixelsPerTick / snap) * snap;
    const deltaPitch = -Math.round((event.clientY - d.y) / ROW);
    if (deltaTick || deltaPitch) d.changed = true;
    const notes =
      d.mode === "resize"
        ? resizeEditedNote(
            d.original,
            d.note.id,
            d.note.durationTicks + deltaTick,
            snap,
            pattern.lengthTicks,
          )
        : moveSelectedNotes(
            d.original,
            d.ids,
            deltaTick,
            deltaPitch,
            pattern.lengthTicks,
          );
    draftRef.current = notes;
    setDraft(notes);
  }
  function pointerUp() {
    if (boxRef.current) {
      const b = boxRef.current;
      const x1 = Math.min(b.x, b.endX),
        x2 = Math.max(b.x, b.endX),
        y1 = Math.min(b.y, b.endY),
        y2 = Math.max(b.y, b.endY);
      onSelect(
        pattern.notes
          .filter(
            (n) =>
              n.startTick * pixelsPerTick < x2 &&
              (n.startTick + n.durationTicks) * pixelsPerTick > x1 &&
              (HIGH - n.pitch) * ROW < y2 &&
              (HIGH - n.pitch + 1) * ROW > y1,
          )
          .map((n) => n.id),
      );
      boxRef.current = null;
      setBox(null);
    }
    const d = drag.current;
    if (d?.changed && draftRef.current)
      onChange(
        draftRef.current,
        d.mode === "resize" ? "Resize note" : "Move notes",
      );
    drag.current = null;
    draftRef.current = null;
    setDraft(null);
  }
  function applyVelocity(value: number) {
    setVelocity(value);
    selectionVelocity.current = value;
  }
  function commitVelocity() {
    if (selectionVelocity.current === null || !selectedIds.length) return;
    const value = selectionVelocity.current / 100;
    onChange(
      pattern.notes.map((n) =>
        selectedIds.includes(n.id) ? { ...n, velocity: value } : n,
      ),
      "Change velocity",
    );
    selectionVelocity.current = null;
  }
  function addChord() {
    const notes = buildEditorChord(
      chordRoot,
      currentTick(),
      chord,
      pattern.lengthTicks,
      voicing,
    );
    onChange([...pattern.notes, ...notes], "Insert chord");
    onSelect(notes.map((n) => n.id));
    notes.forEach((n) => onAudition(n.pitch, n.velocity));
  }
  // The playhead is moved by writing to its DOM node, so playback never re-renders the grid.
  useTransportDraw(
    (readings) => {
      const line = playheadRef.current;
      if (!line) return;
      const moving = readings.playing || readings.previewing;
      line.hidden = !moving;
      if (moving)
        line.style.transform = `translateX(${(editorTick(readings, pattern.lengthTicks, clipStart) * pixelsPerTick).toFixed(2)}px)`;
    },
    [pattern.lengthTicks, clipStart, pixelsPerTick],
  );
  const gridStyle = {
    width: gridWidth,
    height: pitches.length * ROW,
    "--beat-width": `${PPQ * pixelsPerTick}px`,
    "--snap-width": `${snap * pixelsPerTick}px`,
    "--bar-width": `${BAR * pixelsPerTick}px`,
  } as CSSProperties;
  return (
    <div
      className="piano-editor"
      ref={wrapper}
      onKeyDown={onKeys}
      tabIndex={-1}
      aria-label="Piano Roll editor"
    >
      <div className="note-tools">
        <div className="editor-tool-group">
          <span className="editor-tool-label">SNAP</span>
          <select
            aria-label="Piano roll snap"
            value={snap}
            onChange={(e) => setSnap(Number(e.target.value))}
          >
            <option value={480}>1/4</option>
            <option value={240}>1/8</option>
            <option value={120}>1/16</option>
            <option value={60}>1/32</option>
          </select>
          <button
            onClick={() =>
              onChange(
                quantizeSelectedNotes(
                  pattern.notes,
                  selectedIds,
                  snap,
                  pattern.lengthTicks,
                ),
                "Quantize notes",
              )
            }
            title="Quantize selected notes, or all notes"
          >
            Quantize
          </button>
        </div>
        <div className="editor-tool-group editor-chord-tools">
          <select
            aria-label="Chord in key"
            title={`Chords that belong to ${musicalKey}`}
            value={
              keyChords.find(
                (c) => c.root === chordRoot % 12 && c.quality === chord,
              )?.degree ?? ""
            }
            onChange={(e) => {
              const picked = keyChords[Number(e.target.value)];
              if (!picked) return;
              // Keep the root between G3 and F♯4 so chords sit in the keyboard's warm middle.
              setChordRoot(
                picked.root >= 7 ? 48 + picked.root : 60 + picked.root,
              );
              setChord(picked.quality);
            }}
          >
            <option value="" disabled>
              In key
            </option>
            {keyChords.map((c) => (
              <option key={c.degree} value={c.degree}>
                {c.roman} · {chordSymbol(c.root, c.quality, musicalKey)}
              </option>
            ))}
          </select>
          <select
            aria-label="Chord root"
            value={chordRoot}
            onChange={(e) => setChordRoot(Number(e.target.value))}
          >
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i} value={i >= 7 ? 48 + i : 60 + i}>
                {pitchClassName(i, musicalKey)}
              </option>
            ))}
          </select>
          <select
            aria-label="Chord type"
            value={chord}
            onChange={(e) => setChord(e.target.value as ChordQuality)}
          >
            {(Object.keys(CHORD_LABELS) as ChordQuality[]).map((quality) => (
              <option key={quality} value={quality}>
                {CHORD_LABELS[quality]}
              </option>
            ))}
          </select>
          <select
            aria-label="Chord voicing"
            title="How the chord is spread across the keyboard"
            value={voicing}
            onChange={(e) => setVoicing(e.target.value as VoicingStyle)}
          >
            <option value="close">Close</option>
            <option value="open">Open</option>
            <option value="rootless">Rootless</option>
            <option value="shell">Shell</option>
          </select>
          <button
            onClick={addChord}
            title="Insert an editable chord at the playhead"
          >
            <Plus size={13} /> Chord
          </button>
        </div>
        <div className="editor-tool-group">
          <button
            className="editor-icon"
            disabled={!selectedIds.length}
            onClick={copy}
            title="Copy notes · ⌘/Ctrl C"
            aria-label="Copy notes"
          >
            <Copy size={14} />
          </button>
          <button
            className="editor-icon"
            disabled={!selectedIds.length}
            onClick={duplicate}
            title="Duplicate notes · ⌘/Ctrl D"
            aria-label="Duplicate notes"
          >
            <CopyPlus size={14} />
          </button>
          <button
            className="editor-icon"
            disabled={!selectedIds.length}
            onClick={removeSelected}
            title="Delete notes · Delete"
            aria-label="Delete notes"
          >
            <Trash2 size={14} />
          </button>
        </div>
        <div className="editor-tool-group editor-zoom">
          <button
            className="editor-icon"
            onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
            disabled={zoom <= 0.5}
            aria-label="Zoom out piano roll"
          >
            <Minus size={13} />
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button
            className="editor-icon"
            onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
            disabled={zoom >= 3}
            aria-label="Zoom in piano roll"
          >
            <Plus size={13} />
          </button>
        </div>
      </div>
      <div className="roll-scroll" ref={scroller}>
        <div className="roll-content" style={{ width: gridWidth + KEY_WIDTH }}>
          <div className="roll-ruler" style={{ width: gridWidth + KEY_WIDTH }}>
            <div className="ruler-key-label">NOTE</div>
            <div className="roll-bar-labels" style={{ width: gridWidth }}>
              {Array.from(
                { length: Math.ceil(pattern.lengthTicks / BAR) },
                (_, i) => (
                  <span key={i} style={{ left: i * BAR * pixelsPerTick }}>
                    {i + 1}
                    <small>.1</small>
                  </span>
                ),
              )}
            </div>
          </div>
          <div className="roll-body" style={{ height: pitches.length * ROW }}>
            <div className="roll-keys">
              {pitches.map((pitch) => (
                <button
                  key={pitch}
                  type="button"
                  className={`${[1, 3, 6, 8, 10].includes(pitch % 12) ? "black-key" : "white-key"} ${pitch % 12 === 0 ? "octave-key" : ""}`}
                  style={{ height: ROW }}
                  aria-label={`Audition ${noteLabel(pitch)}`}
                  title={noteLabel(pitch)}
                  onClick={() => onAudition(pitch)}
                >
                  {pitch % 12 === 0 ? noteLabel(pitch) : ""}
                </button>
              ))}
            </div>
            <div
              className="roll-grid"
              ref={grid}
              style={gridStyle}
              onPointerDown={blankDown}
              onPointerMove={pointerMove}
              onPointerUp={pointerUp}
              onPointerCancel={() => {
                drag.current = null;
                draftRef.current = null;
                setDraft(null);
                boxRef.current = null;
                setBox(null);
              }}
              aria-label="Note grid — click to draw a note"
            >
              {pitches.map((pitch, i) => (
                <div
                  key={pitch}
                  className={`roll-row ${scale.includes(pitch % 12) ? "in-scale" : "out-scale"} ${pitch % 12 === 0 ? "octave-row" : ""}`}
                  style={{ top: i * ROW, height: ROW }}
                />
              ))}
              {visibleNotes
                .filter((n) => n.pitch >= LOW && n.pitch <= HIGH)
                .map((note) => (
                  <button
                    key={note.id}
                    type="button"
                    className={`midi-note ${selectedIds.includes(note.id) ? "is-selected" : ""}`}
                    style={{
                      left: note.startTick * pixelsPerTick,
                      top: (HIGH - note.pitch) * ROW + 2,
                      width: Math.max(
                        6,
                        note.durationTicks * pixelsPerTick - 1,
                      ),
                      height: ROW - 3,
                      opacity: 0.62 + note.velocity * 0.38,
                    }}
                    aria-label={`${noteLabel(note.pitch)}, beat ${(note.startTick / PPQ + 1).toFixed(2)}, ${note.durationTicks / PPQ} beats`}
                    aria-pressed={selectedIds.includes(note.id)}
                    onPointerDown={(e) => noteDown(e, note)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      onChange(
                        pattern.notes.filter((n) => n.id !== note.id),
                        "Delete note",
                      );
                      onSelect(selectedIds.filter((id) => id !== note.id));
                    }}
                    onFocus={() => {
                      if (!selectedIds.includes(note.id)) onSelect([note.id]);
                    }}
                  >
                    <span>
                      {note.durationTicks * pixelsPerTick > 32
                        ? noteLabel(note.pitch)
                        : ""}
                    </span>
                    <span
                      className="note-resize"
                      title="Drag to resize"
                      onPointerDown={(e) =>
                        noteDown(
                          e as unknown as PointerEvent<HTMLButtonElement>,
                          note,
                          true,
                        )
                      }
                    />
                  </button>
                ))}
              {box && (
                <div
                  className="note-selection-box"
                  style={{
                    left: Math.min(box.x, box.endX),
                    top: Math.min(box.y, box.endY),
                    width: Math.abs(box.endX - box.x),
                    height: Math.abs(box.endY - box.y),
                  }}
                />
              )}
              <div className="editor-playhead" ref={playheadRef} hidden />
            </div>
          </div>
        </div>
      </div>
      <div className="note-footer">
        <div className="velocity-control">
          <span className="editor-tool-label">VELOCITY</span>
          <input
            type="range"
            min="1"
            max="100"
            aria-label="Selected note velocity"
            value={velocity}
            disabled={!selected.length}
            onChange={(e) => applyVelocity(Number(e.target.value))}
            onPointerUp={commitVelocity}
            onKeyUp={commitVelocity}
            onBlur={commitVelocity}
          />
          <span className="tabular">{selected.length ? velocity : "—"}</span>
        </div>
        <span className="note-count">
          {selected.length
            ? `${selected.length} selected`
            : `${pattern.notes.length} notes`}
        </span>
        <span className="editor-help">
          <Scissors size={11} />
          {notice}
        </span>
        <span className="scale-label">{musicalKey}</span>
      </div>
    </div>
  );
}
