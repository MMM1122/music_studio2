import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
  Play,
  Square,
} from "lucide-react";
import type {
  AudioAsset,
  AudioClip,
  ReferenceInfo,
  Track,
} from "../domain/models";
import { uid } from "../domain/models";
import { secondsToTicks, ticksToSeconds } from "../domain/timing";
import { engine } from "../audio/engine";
import { waveformPeaks, tempoSamples } from "../audio/analysis/pcm";
import type { TempoResult } from "../audio/analysis/tempo";
import { useProjectStore } from "../stores/projectStore";
import {
  refreshTransport,
  useTransportDraw,
  useTransportStore,
} from "../stores/transportStore";
import "../themes/reference-analysis.css";
const time = (value: number) =>
  `${Math.floor(Math.max(0, value) / 60)}:${String(Math.floor(Math.max(0, value) % 60)).padStart(2, "0")}`;
export function ReferenceAnalysis({
  track,
  clip,
  asset,
  onSeek,
  notify,
  assetRevision = 0,
}: {
  track: Track;
  clip: AudioClip;
  asset?: AudioAsset;
  onSeek: (tick: number) => void;
  notify: (message: string) => void;
  assetRevision?: number;
}) {
  const bpm = useProjectStore((s) => s.project.transport.bpm),
    projectId = useProjectStore((s) => s.project.id);
  const playing = useTransportStore((s) => s.playing);
  const [open, setOpen] = useState(true),
    [peaks, setPeaks] = useState<Float32Array<ArrayBuffer> | null>(null),
    [zoom, setZoom] = useState(1),
    [windowStart, setWindowStart] = useState(0),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [markerLabel, setMarkerLabel] = useState("Intro"),
    [markerTime, setMarkerTime] = useState("0"),
    [bpmDraft, setBpmDraft] = useState(
      String(track.reference?.manualBpm ?? track.reference?.tempo?.bpm ?? ""),
    );
  const worker = useRef<Worker | null>(null),
    abort = useRef<AbortController | null>(null),
    generation = useRef(0),
    canvas = useRef<HTMLCanvasElement>(null),
    head = useRef<HTMLDivElement>(null);
  const buffer = engine.getAssetBuffer(clip.assetId),
    duration = asset?.duration ?? buffer?.duration ?? 0;
  const visible = duration / zoom,
    start = Math.min(windowStart, Math.max(0, duration - visible));
  const reference = track.reference ?? { markers: [] };
  function cancel() {
    generation.current++;
    abort.current?.abort();
    worker.current?.terminate();
    worker.current = null;
    setBusy(false);
  }
  useEffect(() => {
    let active = true;
    setPeaks(null);
    if (buffer)
      void waveformPeaks(buffer).then((result) => {
        if (active) setPeaks(result);
      });
    return () => {
      active = false;
    };
  }, [buffer, assetRevision]);
  useEffect(
    () => () => {
      generation.current++;
      abort.current?.abort();
      worker.current?.terminate();
    },
    [track.id, clip.assetId, projectId],
  );
  useEffect(() => {
    setBpmDraft(
      String(track.reference?.manualBpm ?? track.reference?.tempo?.bpm ?? ""),
    );
  }, [track.reference?.manualBpm, track.reference?.tempo?.bpm]);
  function edit(label: string, fn: (data: ReferenceInfo) => void) {
    if (useProjectStore.getState().project.id !== projectId) return;
    useProjectStore.getState().update(label, (p) => {
      const target = p.tracks.find((t) => t.id === track.id);
      if (
        !target ||
        !target.clips.some(
          (c) => c.type === "audio" && c.assetId === clip.assetId,
        )
      )
        return;
      target.reference ??= { markers: [] };
      fn(target.reference);
    });
  }
  const sourceAt = (tick: number) =>
    clip.offsetSeconds + ticksToSeconds(tick - clip.startTick, bpm);
  function seekSource(seconds: number) {
    const end = Math.min(
      duration,
      clip.offsetSeconds + ticksToSeconds(clip.durationTicks, bpm),
    );
    const bounded = Math.max(
      clip.offsetSeconds,
      Math.min(Math.max(clip.offsetSeconds, end - 0.001), seconds),
    );
    onSeek(clip.startTick + secondsToTicks(bounded - clip.offsetSeconds, bpm));
    setMarkerTime(bounded.toFixed(2));
  }
  useTransportDraw(
    ({ tick }) => {
      if (head.current) {
        const seconds = sourceAt(tick);
        head.current.style.left = `${((seconds - start) / Math.max(0.001, visible)) * 100}%`;
        head.current.style.visibility =
          seconds >= start && seconds <= start + visible ? "visible" : "hidden";
      }
    },
    [start, visible, bpm, clip.startTick, clip.offsetSeconds, open],
  );
  useEffect(() => {
    const node = canvas.current;
    if (!node || !peaks) return;
    const draw = () => {
      const width = Math.max(1, node.clientWidth),
        height = 136,
        dpr = Math.min(2, devicePixelRatio || 1);
      node.width = width * dpr;
      node.height = height * dpr;
      const ctx = node.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      const style = getComputedStyle(node);
      ctx.fillStyle = style.getPropertyValue("--color-surface");
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = style.getPropertyValue("--color-border");
      ctx.beginPath();
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.stroke();
      ctx.fillStyle = style.getPropertyValue("--color-slate");
      for (let x = 0; x < width; x += 2) {
        const first = Math.floor(
            ((start + (x / width) * visible) / Math.max(0.001, duration)) *
              peaks.length,
          ),
          last = Math.ceil(
            ((start + ((x + 2) / width) * visible) /
              Math.max(0.001, duration)) *
              peaks.length,
          );
        let peak = 0;
        for (
          let i = Math.max(0, first);
          i < Math.min(peaks.length, Math.max(first + 1, last));
          i++
        )
          peak = Math.max(peak, peaks[i]);
        const h = Math.max(0.6, peak * 120);
        ctx.fillRect(x, (height - h) / 2, 1.4, h);
      }
    };
    draw();
    const resize = new ResizeObserver(draw);
    resize.observe(node);
    const theme = new MutationObserver(draw);
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => {
      resize.disconnect();
      theme.disconnect();
    };
  }, [peaks, start, visible, duration, open]);
  async function analyze() {
    if (!buffer) return;
    cancel();
    const token = ++generation.current;
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setNotice("Preparing a bounded local analysis…");
    try {
      const data = await tempoSamples(buffer, controller.signal);
      if (token !== generation.current) return;
      const instance = new Worker(
        new URL("../audio/analysis/tempo.worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.current = instance;
      instance.onmessage = (
        event: MessageEvent<{ result?: TempoResult; error?: string }>,
      ) => {
        if (token !== generation.current) return;
        instance.terminate();
        worker.current = null;
        setBusy(false);
        if (event.data.error) {
          setNotice(event.data.error);
          return;
        }
        const result = event.data.result!;
        if (result.bpm === null) {
          edit("Clear uncertain tempo", (r) => {
            delete r.tempo;
          });
          setNotice(
            "No reliable periodic pulse found. Try a longer, rhythmic passage or enter BPM manually.",
          );
          return;
        }
        edit("Analyze reference tempo", (r) => {
          r.tempo = { ...result, bpm: result.bpm! };
        });
        setNotice(
          `Analyzed ${time(data.startSeconds)}–${time(data.startSeconds + result.analyzedSeconds)} locally. Live performances may change tempo; check the estimate by listening.`,
        );
      };
      instance.onerror = () => {
        if (token === generation.current) {
          instance.terminate();
          worker.current = null;
          setBusy(false);
          setNotice(
            "The analysis worker could not run. Enter BPM manually or reload and try again.",
          );
        }
      };
      instance.postMessage({ pcm: data.pcm, sampleRate: data.sampleRate }, [
        data.pcm.buffer,
      ]);
    } catch (error) {
      if (token === generation.current) {
        setBusy(false);
        setNotice(error instanceof Error ? error.message : "Analysis failed.");
      }
    }
  }
  async function toggle() {
    try {
      if (engine.isPlaying()) engine.pause();
      else await engine.play(useProjectStore.getState().project);
      refreshTransport();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Audio could not start.");
    }
  }
  const manual = Number(bpmDraft),
    validBpm =
      bpmDraft !== "" &&
      Number.isFinite(manual) &&
      manual >= 30 &&
      manual <= 300;
  return (
    <section
      className="reference-analysis"
      aria-label="Reference track analysis"
    >
      <div className="reference-heading">
        <div>
          <span className="eyebrow">REFERENCE / ORIGINAL SPEED</span>
          <h3>{asset?.name ?? track.name}</h3>
          <p>{time(duration)} · Local audio · Excluded from WAV export</p>
        </div>
        <button
          className="button small"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          Audio Analysis{" "}
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>
      {open && (
        <>
          {!buffer ? (
            <p className="reference-notice" role="status">
              Audio is loading or missing from this browser. If it does not
              load, re-import the original recording from Samples.
            </p>
          ) : (
            <>
              <div className="reference-wave-controls">
                <button className="button small" onClick={() => void toggle()}>
                  {playing ? <Square size={12} /> : <Play size={12} />}{" "}
                  {playing ? "Pause timeline" : "Play timeline"}
                </button>
                <label>
                  Waveform zoom
                  <select
                    aria-label="Reference waveform zoom"
                    value={zoom}
                    onChange={(e) => setZoom(Number(e.target.value))}
                  >
                    {[1, 2, 4, 8, 16].map((v) => (
                      <option key={v} value={v}>
                        {v}×
                      </option>
                    ))}
                  </select>
                </label>
                <span>Click the waveform to seek · Source time</span>
              </div>
              <div
                className="reference-wave"
                data-testid="reference-waveform"
                data-peak-count={peaks?.length ?? 0}
              >
                <canvas
                  ref={canvas}
                  role="slider"
                  tabIndex={0}
                  aria-label="Reference waveform seek"
                  aria-valuemin={0}
                  aria-valuemax={duration}
                  aria-valuenow={Number(markerTime) || 0}
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    seekSource(
                      start + ((e.clientX - rect.left) / rect.width) * visible,
                    );
                  }}
                  onKeyDown={(e) => {
                    if (
                      ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)
                    ) {
                      e.preventDefault();
                      seekSource(
                        e.key === "Home"
                          ? 0
                          : e.key === "End"
                            ? duration
                            : sourceAt(engine.getTick()) +
                              (e.key === "ArrowRight" ? 1 : -1),
                      );
                    }
                  }}
                />
                <div ref={head} className="reference-playhead" />
              </div>
              <div className="reference-time-ruler">
                {Array.from({ length: 6 }, (_, i) => (
                  <span key={i}>
                    {time(start + (visible * i) / 5)}
                    {visible < 10
                      ? `.${Math.floor(((start + (visible * i) / 5) % 1) * 10)}`
                      : ""}
                  </span>
                ))}
              </div>
              <label className="reference-navigation">
                Navigate recording{" "}
                <input
                  aria-label="Reference waveform position"
                  type="range"
                  min="0"
                  max={Math.max(0, duration - visible)}
                  step=".1"
                  value={start}
                  disabled={zoom === 1}
                  onChange={(e) => setWindowStart(Number(e.target.value))}
                />
                <span>
                  {time(start)}–{time(start + visible)}
                </span>
              </label>
              <Spectrum trackId={track.id} />
            </>
          )}
          <div className="reference-tools-grid">
            <section className="reference-tool">
              <h4>Tempo / estimate & verify</h4>
              <div className="reference-actions">
                <button
                  className="button small"
                  disabled={!buffer || busy}
                  onClick={() => void analyze()}
                >
                  {busy ? "Analyzing…" : "Estimate BPM"}
                </button>
                {busy && (
                  <button
                    className="button small"
                    onClick={() => {
                      cancel();
                      setNotice("Analysis cancelled.");
                    }}
                  >
                    Cancel analysis
                  </button>
                )}
              </div>
              {reference.tempo && (
                <div className="reference-tempo-result">
                  <strong>{reference.tempo.bpm.toFixed(1)} BPM</strong>
                  <span>
                    {reference.tempo.confidence < 0.55
                      ? "Uncertain estimate"
                      : "Estimated pulse"}{" "}
                    · {Math.round(reference.tempo.confidence * 100)}%
                    periodicity
                  </span>
                  <p>
                    Possible half/double time:{" "}
                    {reference.tempo.alternatives
                      .map((v) => `${v} BPM`)
                      .join(" / ")}
                    . Confidence measures pulse regularity, not musical
                    certainty.
                  </p>
                </div>
              )}
              <p className="reference-notice" role="status">
                {notice ||
                  "Local onset-envelope and autocorrelation estimate. At most three minutes from the middle are analyzed. The project tempo never changes automatically."}
              </p>
              <div className="reference-actions">
                <label>
                  Manual BPM
                  <input
                    aria-label="Reference manual BPM"
                    type="number"
                    min="30"
                    max="300"
                    step=".1"
                    value={bpmDraft}
                    onChange={(e) => {
                      setBpmDraft(e.target.value);
                      const n = Number(e.target.value);
                      if (e.target.value && n >= 30 && n <= 300)
                        edit("Correct reference BPM", (r) => {
                          r.manualBpm = n;
                        });
                    }}
                  />
                </label>
                <button
                  className="button small"
                  disabled={!validBpm}
                  onClick={() => {
                    useProjectStore
                      .getState()
                      .update("Set BPM from reference", (p) => {
                        p.transport.bpm = manual;
                      });
                    notify(
                      `Project tempo set to ${manual} BPM. Reference speed and pitch are unchanged.`,
                    );
                  }}
                >
                  Set project BPM
                </button>
              </div>
              <p className="reference-notice">
                30–300 BPM. A tempo change keeps reference placement in seconds;
                while playing, voices re-cue together at the current beat.
              </p>
            </section>
            <section className="reference-tool">
              <h4>Structure / your markers</h4>
              <p className="reference-notice">
                Place sections by listening. Markers use source timestamps; no
                automatic structure detection.
              </p>
              <div className="reference-actions">
                <label>
                  Section
                  <select
                    aria-label="New reference marker label"
                    value={markerLabel}
                    onChange={(e) => setMarkerLabel(e.target.value)}
                  >
                    {["Intro", "Verse", "Chorus", "Bridge", "Outro"].map(
                      (label) => (
                        <option key={label}>{label}</option>
                      ),
                    )}
                  </select>
                </label>
                <label>
                  Seconds
                  <input
                    aria-label="New reference marker time"
                    type="number"
                    min="0"
                    max={duration}
                    step=".1"
                    value={markerTime}
                    onChange={(e) => setMarkerTime(e.target.value)}
                  />
                </label>
                <button
                  className="button small"
                  onClick={() =>
                    setMarkerTime(
                      Math.max(
                        0,
                        Math.min(duration, sourceAt(engine.getTick())),
                      ).toFixed(2),
                    )
                  }
                >
                  Use playhead
                </button>
                <button
                  className="button small"
                  disabled={
                    !Number.isFinite(Number(markerTime)) ||
                    Number(markerTime) < 0 ||
                    Number(markerTime) > duration ||
                    reference.markers.length >= 500
                  }
                  onClick={() =>
                    edit("Add reference marker", (r) => {
                      r.markers.push({
                        id: uid(),
                        label: markerLabel,
                        timeSeconds: Number(markerTime),
                      });
                      r.markers.sort((a, b) => a.timeSeconds - b.timeSeconds);
                    })
                  }
                >
                  <Plus size={12} />
                  Add marker
                </button>
              </div>
              <div className="reference-markers">
                {reference.markers.map((marker) => (
                  <div className="reference-marker" key={marker.id}>
                    <button
                      className="button small"
                      aria-label={`Jump to ${marker.label} at ${time(marker.timeSeconds)}`}
                      onClick={() => seekSource(marker.timeSeconds)}
                    >
                      {time(marker.timeSeconds)}
                    </button>
                    <input
                      aria-label={`Marker label ${marker.label}`}
                      maxLength={120}
                      value={marker.label}
                      onChange={(e) => {
                        if (e.target.value.trim())
                          edit("Rename reference marker", (r) => {
                            const m = r.markers.find((m) => m.id === marker.id);
                            if (m) m.label = e.target.value;
                          });
                      }}
                    />
                    <input
                      aria-label={`Marker time ${marker.label}`}
                      type="number"
                      min="0"
                      max={duration}
                      step=".1"
                      value={marker.timeSeconds}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (Number.isFinite(n))
                          edit("Move reference marker", (r) => {
                            const m = r.markers.find((m) => m.id === marker.id);
                            if (m)
                              m.timeSeconds = Math.max(
                                0,
                                Math.min(duration, n),
                              );
                          });
                      }}
                    />
                    <button
                      className="icon-button"
                      aria-label={`Delete marker ${marker.label}`}
                      onClick={() =>
                        edit("Delete reference marker", (r) => {
                          r.markers = r.markers.filter(
                            (m) => m.id !== marker.id,
                          );
                        })
                      }
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </>
      )}
    </section>
  );
}
function Spectrum({ trackId }: { trackId: string }) {
  const canvas = useRef<HTMLCanvasElement>(null),
    caption = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const data = new Float32Array(1024);
    let frame = 0,
      last = 0,
      visible = true;
    const node = canvas.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => {
      visible = entries[0]?.isIntersecting ?? true;
    });
    observer.observe(node);
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (document.hidden || !visible || now - last < 80) return;
      last = now;
      const info = engine.readTrackSpectrum(trackId, data);
      const width = Math.max(1, node.clientWidth),
        height = 118,
        dpr = Math.min(2, devicePixelRatio || 1);
      if (
        node.width !== Math.floor(width * dpr) ||
        node.height !== height * dpr
      ) {
        node.width = Math.floor(width * dpr);
        node.height = height * dpr;
      }
      const ctx = node.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const style = getComputedStyle(node),
        x = (hz: number) =>
          40 + (Math.log10(Math.max(20, hz) / 20) / 3) * (width - 50),
        y = (db: number) =>
          12 + ((Math.max(-100, Math.min(0, db)) * -1) / 100) * 82;
      ctx.strokeStyle = style.getPropertyValue("--color-border");
      ctx.fillStyle = style.getPropertyValue("--color-text-secondary");
      ctx.font = "9px sans-serif";
      for (const db of [-80, -40, 0]) {
        ctx.beginPath();
        ctx.moveTo(38, y(db));
        ctx.lineTo(width, y(db));
        ctx.stroke();
        ctx.fillText(`${db} dB`, 0, y(db) + 3);
      }
      for (const hz of [20, 100, 1000, 10000, 20000])
        ctx.fillText(
          hz < 1000 ? `${hz} Hz` : `${hz / 1000}k`,
          Math.min(width - 28, x(hz)),
          112,
        );
      let peak = -120,
        peakHz = 0;
      ctx.strokeStyle = style.getPropertyValue("--color-slate");
      ctx.beginPath();
      let first = true;
      if (info)
        for (let i = 1; i < data.length; i++) {
          const hz = (i * info.sampleRate) / info.fftSize;
          if (hz > 20000) break;
          const db = Number.isFinite(data[i]) ? data[i] : -100;
          if (db > peak) {
            peak = db;
            peakHz = hz;
          }
          if (first) {
            ctx.moveTo(x(hz), y(db));
            first = false;
          } else ctx.lineTo(x(hz), y(db));
        }
      ctx.stroke();
      node.dataset.peakHz = String(Math.round(peakHz));
      node.dataset.peakDb = peak.toFixed(1);
      if (caption.current)
        caption.current.textContent =
          peak > -100
            ? `Peak ${Math.round(peakHz)} Hz · ${peak.toFixed(1)} dB`
            : "No signal on this track";
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [trackId]);
  return (
    <div className="reference-spectrum">
      <div className="reference-spectrum-title">
        <span>LIVE FREQUENCY SPECTRUM · SELECTED REFERENCE</span>
        <span ref={caption}>No signal on this track</span>
      </div>
      <canvas
        ref={canvas}
        role="img"
        aria-label="Reference frequency spectrum"
      />
      <p className="reference-notice">
        Post-fader, before the master mix · FFT 2048 · magnitude in dB relative
        to full scale. Mute and A/B listening affect this signal.
      </p>
    </div>
  );
}
