import { useShallow } from "zustand/react/shallow";
import { useRef, useState } from "react";
import {
  Plus,
  Copy,
  Trash2,
  ChevronUp,
  ChevronDown,
  SlidersHorizontal,
  Music2,
  AudioLines,
  Drum,
  Minus,
} from "lucide-react";
import {
  BAR,
  uid,
  type Project,
  type Track,
  type Clip,
} from "../domain/models";
import { createPattern, createMidiClip } from "../domain/factories";
import { engine } from "../audio/engine";
import { useProjectStore } from "../stores/projectStore";
import { TimelinePlayhead } from "./TransportReadouts";

interface Props {
  onSeek: (tick: number) => void;
  onAddTrack: () => void;
  onOpenEditor: () => void;
  onInspector: () => void;
}
export function Arrangement({
  onSeek,
  onAddTrack,
  onOpenEditor,
  onInspector,
}: Props) {
  const {
    tracks,
    patterns,
    loopStart,
    loopEnd,
    loop,
    selectedTrackId,
    selectedClipId,
    selectClip,
    selectTrack,
    update,
  } = useProjectStore(
    useShallow((state) => ({
      tracks: state.project.tracks,
      patterns: state.project.patterns,
      loopStart: state.project.transport.loopStart,
      loopEnd: state.project.transport.loopEnd,
      loop: state.project.transport.loop,
      selectedTrackId: state.selectedTrackId,
      selectedClipId: state.selectedClipId,
      selectClip: state.selectClip,
      selectTrack: state.selectTrack,
      update: state.update,
    })),
  );
  const [barWidth, setBarWidth] = useState(66);
  const [drag, setDrag] = useState<{
    id: string;
    start: number;
    duration: number;
  } | null>(null);
  const dragging = useRef(false);
  const bars = Math.max(
    16,
    Math.ceil(
      Math.max(
        loopEnd,
        ...tracks.flatMap((t) =>
          t.clips.map((c) => c.startTick + c.durationTicks),
        ),
        BAR * 16,
      ) / BAR,
    ) + 2,
  );
  const pp = barWidth / BAR;
  const editTrack = (
    trackId: string,
    fn: (t: Track) => void,
    label = "Edit track",
  ) =>
    update(label, (p) => {
      const t = p.tracks.find((t) => t.id === trackId);
      if (t) fn(t);
    });
  function clipGesture(
    e: React.PointerEvent<HTMLDivElement>,
    track: Track,
    clip: Clip,
    resize = false,
  ) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    selectClip(track.id, clip.id);
    const x = e.clientX;
    const initial = { start: clip.startTick, duration: clip.durationTicks };
    dragging.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
    const target = e.currentTarget;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - x;
      if (Math.abs(dx) > 3) dragging.current = true;
      const delta = Math.round(dx / pp / (BAR / 4)) * (BAR / 4);
      setDrag({
        id: clip.id,
        start: resize ? initial.start : Math.max(0, initial.start + delta),
        duration: resize
          ? Math.max(BAR / 4, initial.duration + delta)
          : initial.duration,
      });
    };
    const up = (ev: PointerEvent) => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", cancel);
      if (dragging.current) {
        const delta = Math.round((ev.clientX - x) / pp / (BAR / 4)) * (BAR / 4);
        editTrack(
          track.id,
          (t) => {
            const c = t.clips.find((c) => c.id === clip.id);
            if (c) {
              if (resize)
                c.durationTicks = Math.max(BAR / 4, initial.duration + delta);
              else c.startTick = Math.max(0, initial.start + delta);
            }
          },
          resize ? "Resize clip" : "Move clip",
        );
      }
      setDrag(null);
    };
    const cancel = () => {
      setDrag(null);
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", cancel);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", cancel);
  }
  function newClip(e: React.MouseEvent, track: Track) {
    if (track.type === "audio") return;
    const rect = e.currentTarget.getBoundingClientRect();
    const startTick = Math.floor((e.clientX - rect.left) / barWidth) * BAR;
    const pattern = createPattern(
      track.type === "drums" ? "drums" : "midi",
      track.type === "drums" ? BAR : BAR * 4,
    );
    const clip = createMidiClip(pattern, startTick);
    update("Create clip", (p) => {
      p.patterns[pattern.id] = pattern;
      p.tracks.find((t) => t.id === track.id)!.clips.push(clip);
    });
    selectClip(track.id, clip.id);
    onOpenEditor();
  }
  function duplicate() {
    const t = tracks.find((t) => t.id === selectedTrackId);
    const c = t?.clips.find((c) => c.id === selectedClipId);
    if (!t || !c) return;
    const copy = { ...c, id: uid(), startTick: c.startTick + c.durationTicks };
    editTrack(t.id, (t) => t.clips.push(copy), "Duplicate clip");
    selectClip(t.id, copy.id);
  }
  const selectedClip = tracks
    .flatMap((t) => t.clips)
    .find((c) => c.id === selectedClipId);
  return (
    <section className="arrangement" aria-label="Arrangement">
      <div className="section-toolbar">
        <div className="section-title">
          <span className="section-index">01</span> Arrangement{" "}
          <span className="tag">{tracks.length} tracks</span>
        </div>
        <div className="toolbar-actions">
          <button
            className="icon-button"
            title="Duplicate selected clip · ⌘D"
            aria-label="Duplicate clip"
            disabled={!selectedClip}
            onClick={duplicate}
          >
            <Copy />
          </button>
          <button
            className="icon-button"
            title="Delete selected clip"
            aria-label="Delete clip"
            disabled={!selectedClip}
            onClick={() =>
              update("Delete clip", (p) => {
                p.tracks.forEach(
                  (t) =>
                    (t.clips = t.clips.filter((c) => c.id !== selectedClipId)),
                );
              })
            }
          >
            <Trash2 />
          </button>
          <span className="divider" />
          <button
            className="icon-button"
            title="Zoom out timeline"
            onClick={() => setBarWidth(Math.max(32, barWidth - 10))}
          >
            <Minus />
          </button>
          <span className="zoom-value">
            {Math.round((barWidth / 66) * 100)}%
          </span>
          <button
            className="icon-button"
            title="Zoom in timeline"
            onClick={() => setBarWidth(Math.min(180, barWidth + 10))}
          >
            <Plus />
          </button>
          <button
            className="icon-button"
            title="Toggle inspector"
            onClick={onInspector}
          >
            <SlidersHorizontal />
          </button>
        </div>
      </div>
      <div className="timeline-scroll">
        <div
          className="timeline-content"
          style={{ width: 168 + bars * barWidth }}
        >
          <div className="timeline-ruler">
            <div className="track-column ruler-label">
              TRACKS <span>4/4</span>
            </div>
            <div
              className="ruler-grid"
              style={{ width: bars * barWidth }}
              onClick={(e) =>
                onSeek(
                  Math.max(
                    0,
                    Math.round(
                      (e.clientX -
                        e.currentTarget.getBoundingClientRect().left) /
                        pp /
                        120,
                    ) * 120,
                  ),
                )
              }
              title="Click to seek"
            >
              <div
                className="loop-region"
                style={{
                  left: loopStart * pp,
                  width: (loopEnd - loopStart) * pp,
                  opacity: loop ? 1 : 0.35,
                }}
              >
                <span>LOOP</span>
              </div>
              {Array.from({ length: bars }, (_, i) => (
                <span
                  className="bar-number"
                  key={i}
                  style={{ left: i * barWidth }}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
              ))}
            </div>
          </div>
          {tracks.map((track, idx) => (
            <div
              className={`track-row ${track.id === selectedTrackId ? "selected" : ""} ${track.mixer.mute ? "muted-track" : ""}`}
              key={track.id}
              data-color={track.color}
            >
              <div
                className="track-column track-header"
                onClick={() => selectTrack(track.id)}
              >
                <div className="track-top">
                  <span className="track-stripe" />
                  <span className="track-number">
                    {String(idx + 1).padStart(2, "0")}
                  </span>
                  {track.type === "drums" ? (
                    <Drum size={14} />
                  ) : track.type === "audio" ? (
                    <AudioLines size={14} />
                  ) : (
                    <Music2 size={14} />
                  )}
                  <span className="track-name" title={track.name}>
                    {track.name}
                  </span>
                </div>
                <div className="track-controls">
                  <button
                    className={track.mixer.mute ? "on" : ""}
                    title={`Mute ${track.name}`}
                    aria-label={`Mute ${track.name}`}
                    aria-pressed={track.mixer.mute}
                    onClick={(e) => {
                      e.stopPropagation();
                      editTrack(track.id, (t) => {
                        t.mixer.mute = !t.mixer.mute;
                      });
                    }}
                  >
                    M
                  </button>
                  <button
                    className={track.mixer.solo ? "on" : ""}
                    title={`Solo ${track.name}`}
                    aria-label={`Solo ${track.name}`}
                    aria-pressed={track.mixer.solo}
                    onClick={(e) => {
                      e.stopPropagation();
                      editTrack(track.id, (t) => {
                        t.mixer.solo = !t.mixer.solo;
                      });
                    }}
                  >
                    S
                  </button>
                  <input
                    title={`${track.name} volume`}
                    aria-label={`${track.name} volume`}
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={track.mixer.volume}
                    onChange={(e) =>
                      editTrack(track.id, (t) => {
                        t.mixer.volume = +e.target.value;
                      })
                    }
                  />
                  <div className="track-order">
                    <button
                      title={`Move ${track.name} up`}
                      disabled={idx === 0}
                      onClick={(e) => {
                        e.stopPropagation();
                        update("Reorder track", (p) => {
                          [p.tracks[idx - 1], p.tracks[idx]] = [
                            p.tracks[idx],
                            p.tracks[idx - 1],
                          ];
                        });
                      }}
                    >
                      <ChevronUp />
                    </button>
                    <button
                      title={`Move ${track.name} down`}
                      disabled={idx === tracks.length - 1}
                      onClick={(e) => {
                        e.stopPropagation();
                        update("Reorder track", (p) => {
                          [p.tracks[idx + 1], p.tracks[idx]] = [
                            p.tracks[idx],
                            p.tracks[idx + 1],
                          ];
                        });
                      }}
                    >
                      <ChevronDown />
                    </button>
                  </div>
                </div>
              </div>
              <div
                className="track-lane"
                style={{
                  width: bars * barWidth,
                  backgroundSize: `${barWidth}px 100%, ${barWidth / 4}px 100%`,
                }}
                onDoubleClick={(e) => newClip(e, track)}
              >
                {!track.clips.length && (
                  <span className="lane-hint">
                    {track.type === "audio"
                      ? "Import a sample to start"
                      : "Double-click to create a clip"}
                  </span>
                )}
                {track.clips.map((clip) => {
                  const d = drag?.id === clip.id ? drag : null;
                  return (
                    <div
                      key={clip.id}
                      tabIndex={0}
                      role="button"
                      aria-label={`Clip ${clip.name}`}
                      className={`clip ${selectedClipId === clip.id ? "selected" : ""}`}
                      style={{
                        left: (d?.start ?? clip.startTick) * pp,
                        width: (d?.duration ?? clip.durationTicks) * pp - 3,
                      }}
                      onPointerDown={(e) => clipGesture(e, track, clip)}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        selectClip(track.id, clip.id);
                        onOpenEditor();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          selectClip(track.id, clip.id);
                          onOpenEditor();
                        }
                      }}
                    >
                      <div className="clip-label">
                        <span>{clip.name}</span>
                        <span>{clip.loop ? "↻" : ""}</span>
                      </div>
                      <ClipMiniature clip={clip} patterns={patterns} />
                      <div
                        className="clip-resize"
                        title="Drag to resize clip"
                        onPointerDown={(e) => clipGesture(e, track, clip, true)}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          <div className="add-track-row">
            <button className="track-column add-track" onClick={onAddTrack}>
              <Plus size={14} /> Add track
            </button>
            <span>Make room for another sound.</span>
          </div>
          <TimelinePlayhead pixelsPerTick={pp} />
        </div>
      </div>
      <div className="arrangement-footer">
        <span>
          Double-click an empty lane to create · Drag clips to arrange
        </span>
        <span>
          {Math.ceil(
            Math.max(
              ...tracks.flatMap((t) =>
                t.clips.map((c) => c.startTick + c.durationTicks),
              ),
              BAR,
            ) / BAR,
          )}{" "}
          bars <span className="dot-separator">·</span> Snap 1 beat
        </span>
      </div>
    </section>
  );
}
function ClipMiniature({
  clip,
  patterns,
}: {
  clip: Clip;
  patterns: Project["patterns"];
}) {
  if (clip.type === "audio") {
    const peaks = engine.getWaveform(clip.assetId);
    return (
      <svg
        className="audio-mini-wave"
        viewBox="0 0 160 40"
        preserveAspectRatio="none"
        aria-label="Audio waveform"
      >
        {peaks.map((v, i) => (
          <rect
            key={i}
            x={i * 2}
            y={20 - v * 19}
            width={1.3}
            height={Math.max(0.7, v * 38)}
          />
        ))}
      </svg>
    );
  }
  const p = patterns[clip.patternId];
  if (!p) return null;
  const pitches = p.notes.map((n) => n.pitch);
  const min = Math.min(...pitches, 48),
    max = Math.max(...pitches, 72);
  const repeats = clip.loop ? Math.ceil(clip.durationTicks / p.lengthTicks) : 1;
  return (
    <svg
      className="clip-miniature"
      viewBox="0 0 1000 45"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {Array.from({ length: Math.min(repeats, 32) }, (_, r) =>
        p.notes.map((n) => (
          <rect
            key={`${r}-${n.id}`}
            x={((n.startTick + r * p.lengthTicks) / clip.durationTicks) * 1000}
            y={38 - ((n.pitch - min) / (max - min || 1)) * 32}
            width={Math.max(
              4,
              (n.durationTicks / clip.durationTicks) * 1000 - 2,
            )}
            height={p.kind === "drums" ? 5 : 3.5}
            rx="1"
          />
        )),
      )}
    </svg>
  );
}
