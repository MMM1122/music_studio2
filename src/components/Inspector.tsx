import { useShallow } from "zustand/react/shallow";
import { X, SlidersHorizontal, Trash2, Copy, Link2 } from "lucide-react";
import {
  INSTRUMENTS,
  BAR,
  uid,
  type Track,
  type InstrumentType,
} from "../domain/models";
import { useProjectStore } from "../stores/projectStore";
import { NumberField } from "./NumberField";
import { useMathLabStore } from "../stores/mathLabStore";
export function Inspector({ onClose }: { onClose: () => void }) {
  const savedPresets = useMathLabStore((state) => state.savedPresets);
  const {
    track,
    trackIndex,
    clip,
    clipAssetDuration,
    selectedTrackId,
    selectedClipId,
    update,
    selectClip,
  } = useProjectStore(
    useShallow((state) => {
      const trackIndex = state.project.tracks.findIndex(
        (t) => t.id === state.selectedTrackId,
      );
      const track = state.project.tracks[trackIndex];
      const clip = track?.clips.find((c) => c.id === state.selectedClipId);
      return {
        track,
        trackIndex,
        clip,
        clipAssetDuration:
          clip?.type === "audio"
            ? state.project.assets.find((a) => a.id === clip.assetId)?.duration
            : undefined,
        selectedTrackId: state.selectedTrackId,
        selectedClipId: state.selectedClipId,
        update: state.update,
        selectClip: state.selectClip,
      };
    }),
  );
  const change = (label: string, fn: (track: Track) => void) =>
    update(
      label,
      (p) => {
        const t = p.tracks.find((t) => t.id === selectedTrackId);
        if (t) fn(t);
      },
      { coalesceKey: `${selectedTrackId}:${label}` },
    );
  const clipChange = (key: string, value: string | number | boolean) =>
    change("Edit clip", (t) => {
      const c = t.clips.find((c) => c.id === selectedClipId);
      if (c) Object.assign(c, { [key]: value });
    });
  return (
    <aside className="inspector">
      <div className="section-toolbar">
        <span className="section-title">
          <SlidersHorizontal size={14} /> Inspector
        </span>
        <button
          className="icon-button"
          title="Close inspector"
          onClick={onClose}
        >
          <X />
        </button>
      </div>
      {!track ? (
        <div className="empty-state">
          <p>Select a track to shape its sound.</p>
        </div>
      ) : (
        <div className="inspector-content" data-color={track.color}>
          <div className="inspector-heading">
            <span className="track-swatch" />
            <span className="tiny muted">
              TRACK {String(trackIndex + 1).padStart(2, "0")}
            </span>
          </div>
          {track.role === "reference" && (
            <p className="library-footnote">
              REFERENCE · Keeps its original speed and seconds when BPM changes.
              Excluded from WAV export. Open Audio Analysis in the clip editor
              for markers and tempo.
            </p>
          )}
          <input
            className="track-title-input"
            aria-label="Track name"
            value={track.name}
            onChange={(e) =>
              change("Rename track", (t) => {
                t.name = e.target.value;
              })
            }
          />
          {track.type !== "audio" && (
            <>
              <label className="field-label">
                Instrument
                <select
                  aria-label="Instrument"
                  value={track.instrument.type}
                  onChange={(e) =>
                    change("Change instrument", (t) => {
                      const preset = savedPresets.find(
                        (p) => `saved:${p.id}` === e.target.value,
                      );
                      if (preset)
                        t.instrument = structuredClone(preset.instrument);
                      else t.instrument.type = e.target.value as InstrumentType;
                    })
                  }
                >
                  {INSTRUMENTS.filter((i) =>
                    track.type === "drums"
                      ? i.type === "drum-kit"
                      : i.type !== "drum-kit",
                  ).map((i) => (
                    <option key={i.type} value={i.type}>
                      {i.name}
                    </option>
                  ))}
                  {track.type === "midi" && savedPresets.length > 0 && (
                    <optgroup label="Your Math Lab sounds">
                      {savedPresets.map((preset) => (
                        <option key={preset.id} value={`saved:${preset.id}`}>
                          {preset.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </label>
              <div className="preset-note">
                {track.instrument.type === "fourier"
                  ? track.instrument.presetName || "Custom harmonics"
                  : "Built-in synthesis"}{" "}
                <span>●</span> Ready
              </div>
            </>
          )}
          <div className="inspector-section">
            <h4>Mix</h4>
            <Range
              label="Volume"
              value={track.mixer.volume}
              min={0}
              max={1}
              step={0.01}
              display={
                track.mixer.volume === 0
                  ? "−∞ dB"
                  : `${(20 * Math.log10(track.mixer.volume)).toFixed(1)} dB`
              }
              onChange={(value) =>
                change("Set volume", (t) => {
                  t.mixer.volume = value;
                })
              }
            />
            <Range
              label="Pan"
              value={track.mixer.pan}
              min={-1}
              max={1}
              step={0.01}
              display={
                track.mixer.pan === 0
                  ? "Center"
                  : `${Math.round(Math.abs(track.mixer.pan) * 100)} ${track.mixer.pan < 0 ? "L" : "R"}`
              }
              onChange={(v) =>
                change("Set pan", (t) => {
                  t.mixer.pan = v;
                })
              }
            />
            <div className="segmented">
              <button
                className={track.mixer.mute ? "active" : ""}
                aria-pressed={track.mixer.mute}
                onClick={() =>
                  change("Mute track", (t) => {
                    t.mixer.mute = !t.mixer.mute;
                  })
                }
              >
                Mute
              </button>
              <button
                className={track.mixer.solo ? "active" : ""}
                aria-pressed={track.mixer.solo}
                onClick={() =>
                  change("Solo track", (t) => {
                    t.mixer.solo = !t.mixer.solo;
                  })
                }
              >
                Solo
              </button>
            </div>
          </div>
          {track.type !== "audio" && (
            <div className="inspector-section">
              <h4>Character</h4>
              <Range
                label="Brightness"
                value={track.instrument.brightness}
                onChange={(v) =>
                  change("Set brightness", (t) => {
                    t.instrument.brightness = v;
                  })
                }
              />
              <div className="two-fields">
                <label className="field-label">
                  Attack (s)
                  <NumberField
                    label="Attack"
                    min={0.001}
                    max={2}
                    step={0.01}
                    precision={3}
                    value={track.instrument.attack}
                    onChange={(attack) =>
                      change("Set attack", (t) => {
                        t.instrument.attack = attack;
                      })
                    }
                  />
                </label>
                <label className="field-label">
                  Release (s)
                  <NumberField
                    label="Release"
                    min={0.01}
                    max={2}
                    step={0.05}
                    value={track.instrument.release}
                    onChange={(release) =>
                      change("Set release", (t) => {
                        t.instrument.release = release;
                      })
                    }
                  />
                </label>
              </div>
            </div>
          )}
          <div className="inspector-section">
            <h4>
              Effects <span className="tiny">INSERTS</span>
            </h4>
            <Range
              label="Reverb"
              value={track.effects.reverb}
              onChange={(v) =>
                change("Set reverb", (t) => {
                  t.effects.reverb = v;
                })
              }
            />
            <Range
              label="Delay"
              value={track.effects.delay}
              onChange={(v) =>
                change("Set delay", (t) => {
                  t.effects.delay = v;
                })
              }
            />
            <Range
              label="Low-pass filter"
              value={track.effects.filter}
              min={80}
              max={20000}
              step={10}
              display={`${(track.effects.filter / 1000).toFixed(1)} kHz`}
              onChange={(v) =>
                change("Set filter", (t) => {
                  t.effects.filter = v;
                })
              }
            />
          </div>
          {clip && (
            <div className="inspector-section">
              <h4>
                Clip <span className="tiny">{clip.type}</span>
              </h4>
              <label className="field-label">
                Name
                <input
                  aria-label="Clip name"
                  value={clip.name}
                  onChange={(e) => clipChange("name", e.target.value)}
                />
              </label>
              <div className="two-fields">
                <label className="field-label">
                  Start (bar)
                  <NumberField
                    label="Clip start bar"
                    min={1}
                    max={4096}
                    step={0.25}
                    precision={4}
                    value={clip.startTick / BAR + 1}
                    onChange={(bar) =>
                      clipChange(
                        "startTick",
                        Math.max(0, Math.round((bar - 1) * BAR)),
                      )
                    }
                  />
                </label>
                <label className="field-label">
                  Length (bars)
                  <NumberField
                    label="Clip length bars"
                    min={0.25}
                    max={4096}
                    step={0.25}
                    precision={4}
                    value={clip.durationTicks / BAR}
                    onChange={(bars) =>
                      clipChange(
                        "durationTicks",
                        Math.max(480, Math.round(bars * BAR)),
                      )
                    }
                  />
                </label>
              </div>
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={clip.loop}
                  onChange={(e) => clipChange("loop", e.target.checked)}
                />
                Loop source
              </label>
              <Range
                label="Clip gain"
                value={clip.gain}
                max={1.5}
                onChange={(v) => clipChange("gain", v)}
              />
              {clip.type === "audio" && (
                <label className="field-label">
                  Trim start (seconds)
                  <NumberField
                    label="Audio trim start"
                    min={0}
                    max={Math.max(0, (clipAssetDuration ?? 1) - 0.01)}
                    step={0.01}
                    value={clip.offsetSeconds}
                    onChange={(seconds) => clipChange("offsetSeconds", seconds)}
                  />
                </label>
              )}
              {clip.type === "midi" && (
                <>
                  <div className="preset-note">
                    <Link2 size={12} /> Reused clips share this pattern
                  </div>
                  <button
                    className="button small"
                    onClick={() => {
                      const pattern = structuredClone(
                        useProjectStore.getState().project.patterns[
                          clip.patternId
                        ],
                      );
                      pattern.id = uid();
                      pattern.name += " copy";
                      pattern.notes.forEach((n) => (n.id = uid()));
                      update("Make pattern unique", (p) => {
                        p.patterns[pattern.id] = pattern;
                        const c = p.tracks
                          .find((t) => t.id === track.id)!
                          .clips.find((c) => c.id === clip.id)!;
                        if (c.type === "midi") c.patternId = pattern.id;
                      });
                      selectClip(track.id, clip.id);
                    }}
                  >
                    <Copy />
                    Make independent
                  </button>
                </>
              )}
            </div>
          )}
          <button
            className="button small danger"
            onClick={() =>
              update("Delete track", (p) => {
                p.tracks = p.tracks.filter((t) => t.id !== track.id);
              })
            }
          >
            <Trash2 />
            Delete track
          </button>
        </div>
      )}
    </aside>
  );
}
export function Range({
  label,
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01,
  display,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  display?: string;
}) {
  return (
    <label className="range-field">
      <span>
        {label}
        <output>{display ?? `${Math.round(value * 100)}%`}</output>
      </span>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(+e.target.value)}
      />
    </label>
  );
}
