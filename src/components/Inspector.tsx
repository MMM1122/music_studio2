import { X, SlidersHorizontal, Trash2, Copy, Link2 } from "lucide-react";
import {
  INSTRUMENTS,
  BAR,
  uid,
  type Track,
  type InstrumentType,
} from "../domain/models";
import { useProjectStore } from "../stores/projectStore";
export function Inspector({ onClose }: { onClose: () => void }) {
  const { project, selectedTrackId, selectedClipId, update, selectClip } =
    useProjectStore();
  const track = project.tracks.find((t) => t.id === selectedTrackId);
  const clip = track?.clips.find((c) => c.id === selectedClipId);
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
              TRACK {String(project.tracks.indexOf(track) + 1).padStart(2, "0")}
            </span>
          </div>
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
                      t.instrument.type = e.target.value as InstrumentType;
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
                </select>
              </label>
              <div className="preset-note">
                Built-in synthesis <span>●</span> Ready
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
                  <input
                    aria-label="Attack"
                    type="number"
                    min="0.001"
                    max="2"
                    step="0.01"
                    value={track.instrument.attack}
                    onChange={(e) =>
                      change("Set attack", (t) => {
                        t.instrument.attack = Math.min(
                          2,
                          Math.max(0.001, +e.target.value),
                        );
                      })
                    }
                  />
                </label>
                <label className="field-label">
                  Release (s)
                  <input
                    aria-label="Release"
                    type="number"
                    min="0.01"
                    max="2"
                    step="0.05"
                    value={track.instrument.release}
                    onChange={(e) =>
                      change("Set release", (t) => {
                        t.instrument.release = Math.min(
                          2,
                          Math.max(0.01, +e.target.value),
                        );
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
                  <input
                    aria-label="Clip start bar"
                    type="number"
                    min="1"
                    step="0.25"
                    value={clip.startTick / BAR + 1}
                    onChange={(e) =>
                      clipChange(
                        "startTick",
                        Math.max(0, Math.round((+e.target.value - 1) * BAR)),
                      )
                    }
                  />
                </label>
                <label className="field-label">
                  Length (bars)
                  <input
                    aria-label="Clip length bars"
                    type="number"
                    min="0.25"
                    step="0.25"
                    value={clip.durationTicks / BAR}
                    onChange={(e) =>
                      clipChange(
                        "durationTicks",
                        Math.max(480, Math.round(+e.target.value * BAR)),
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
                  <input
                    aria-label="Audio trim start"
                    type="number"
                    min="0"
                    step="0.01"
                    value={clip.offsetSeconds}
                    onChange={(e) =>
                      clipChange(
                        "offsetSeconds",
                        Math.min(
                          (project.assets.find((a) => a.id === clip.assetId)
                            ?.duration ?? 1) - 0.01,
                          Math.max(0, +e.target.value),
                        ),
                      )
                    }
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
                        project.patterns[clip.patternId],
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
