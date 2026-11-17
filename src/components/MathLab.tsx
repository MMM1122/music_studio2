import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Play,
  Square,
  RotateCcw,
  Plus,
  Check,
  X,
} from "lucide-react";
import type { Instrument, Pattern } from "../domain/models";
import { createNote, createPattern, createTrack } from "../domain/factories";
import { noteName } from "../domain/theory";
import { engine } from "../audio/engine";
import { useProjectStore } from "../stores/projectStore";
import { refreshTransport, useTransportStore } from "../stores/transportStore";
import { useMathLabStore } from "../stores/mathLabStore";
import {
  generateFunction,
  scaleNotes,
  SCALE_INTERVALS,
  midiToFrequency,
  type FunctionSettings,
} from "../math/functions";
import {
  FOURIER_PRESETS,
  makeFourierInstrument,
  waveformSamples,
} from "../math/fourier";
import {
  feedback,
  generateBayesianMelody,
  nextDegree,
  posteriorFor,
  samplingFor,
  contextKey,
  type BayesContext,
} from "../math/bayesian";
import {
  Slider,
  KeyScale,
  Graph,
  Sequence,
  ROOTS,
} from "./math/MathLabControls";
import { CurveEditor } from "./math/CurveEditor";
import { curvePattern } from "../math/curve";
import { SessionArtwork } from "./SessionArtwork";
import "../themes/math-lab.css";

const FUNCTION_PRESETS = [
  { name: "Sine / a gentle arc", value: "sin(x)" },
  { name: "Two voices", value: "sin(2*x) + 0.5*cos(5*x)" },
  { name: "Fading motion", value: "exp(-x/5)*sin(4*x)" },
  { name: "Ascending", value: "x" },
  { name: "Folded wave", value: "abs(sin(2*x))" },
];
interface Props {
  onAdd: (pattern: Pattern, instrument: Instrument, bpm: number) => void;
  onApplyInstrument: (instrument: Instrument, trackId?: string) => void;
  onStudio: () => void;
  notify: (text: string) => void;
}
export function MathLab({ onAdd, onApplyInstrument, onStudio, notify }: Props) {
  const lab = useMathLabStore();
  const { patch, setTab } = lab;
  const project = useProjectStore((s) => s.project);
  const previewing = useTransportStore((s) => s.previewing);
  const [busy, setBusy] = useState(false),
    [name, setName] = useState("My harmonic study"),
    [target, setTarget] = useState("");
  const [held, setHeld] = useState<number[]>([]),
    [fundamental, setFundamental] = useState(62);
  const [pending, setPending] = useState<{
      degree: number;
      context: BayesContext;
    } | null>(null),
    [evidence, setEvidence] = useState("");
  const request = useRef(0),
    heldRef = useRef(new Set<number>());
  const stop = () => {
    request.current++;
    setBusy(false);
    engine.stopPreview();
    engine.stopLabNotes();
    heldRef.current.clear();
    setHeld([]);
    refreshTransport();
  };
  useEffect(() => {
    const silence = () => {
      request.current++;
      engine.stopPreview();
      engine.stopLabNotes();
      heldRef.current.clear();
      setHeld([]);
      setBusy(false);
      refreshTransport();
    };
    const visibility = () => {
      if (document.hidden) silence();
    };
    window.addEventListener("blur", silence);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      silence();
      window.removeEventListener("blur", silence);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  useEffect(() => {
    engine.updateLabSound(lab.fourier, lab.fourierVolume);
  }, [lab.fourier, lab.fourierVolume]);
  const evaluated = useMemo(() => {
    try {
      return { result: generateFunction(lab.functionSettings), error: "" };
    } catch (e) {
      return {
        result: null,
        error: e instanceof Error ? e.message : "Invalid expression.",
      };
    }
  }, [lab.functionSettings]);
  const sound =
    lab.sound === "fourier"
      ? lab.fourier
      : createTrack("electric-piano").instrument;
  const updateFunction = (values: Partial<FunctionSettings>) => {
    const settings = { ...lab.functionSettings, ...values };
    let pattern = lab.functionPattern;
    let functionCurve = lab.functionCurve;
    try {
      if (Object.keys(values).length !== 1 || values.bpm === undefined) {
        const changesShape = [
          "expression",
          "amplitude",
          "frequency",
          "offset",
        ].some((key) => key in values);
        if (functionCurve && !changesShape)
          pattern = curvePattern(settings, functionCurve);
        else {
          pattern = generateFunction(settings).pattern;
          functionCurve = null;
        }
      }
    } catch {
      stop();
    }
    patch({
      functionSettings: settings,
      functionPattern: pattern,
      functionCurve,
    });
  };
  const curvePoints =
    lab.functionCurve ?? evaluated.result?.normalized ?? Array(16).fill(0.5);
  function updateCurve(points: number[]) {
    patch({
      functionCurve: points,
      functionPattern: curvePattern(lab.functionSettings, points),
    });
  }
  useEffect(() => {
    if (engine.isLivePreviewing())
      engine.updateLivePreview(
        lab.tab === "bayesian" ? lab.bayesPattern : lab.functionPattern,
        lab.sound === "fourier"
          ? lab.fourier
          : createTrack("electric-piano").instrument,
        lab.tab === "bayesian" ? lab.bayesBpm : lab.functionSettings.bpm,
      );
  }, [
    lab.functionPattern,
    lab.bayesPattern,
    lab.functionSettings.bpm,
    lab.bayesBpm,
    lab.sound,
    lab.fourier,
    lab.tab,
  ]);
  function continueCurve() {
    stop();
    const pattern = structuredClone(lab.functionPattern);
    pattern.name = "Curve + probability";
    pattern.notes = pattern.notes.filter((note) => note.startTick < 1920);
    pattern.lengthTicks = 3840;
    const settings = lab.functionSettings,
      intervals = SCALE_INTERVALS[settings.scale],
      last = pattern.notes.at(-1)?.pitch ?? 60 + settings.root;
    const previous = Math.max(
      0,
      intervals.indexOf((last - settings.root + 120) % 12),
    );
    patch({
      bayesPattern: pattern,
      bayesLength: 16,
      bayesBpm: settings.bpm,
      bayesContext: {
        root: settings.root,
        scale: settings.scale,
        chord: 0,
        previous,
      },
      tab: "bayesian",
    });
    setEvidence(
      "Your curve supplies the first bar. Accept suggestions to write an ending. No evidence was added automatically.",
    );
  }
  async function preview(pattern: Pattern, bpm: number) {
    stop();
    const serial = ++request.current;
    setBusy(true);
    try {
      await engine.previewLivePattern(
        { ...project, transport: { ...project.transport, bpm } },
        pattern,
        sound,
      );
      if (serial === request.current) {
        const latest = useMathLabStore.getState();
        engine.updateLivePreview(
          latest.tab === "bayesian"
            ? latest.bayesPattern
            : latest.functionPattern,
          latest.sound === "fourier"
            ? latest.fourier
            : createTrack("electric-piano").instrument,
          latest.tab === "bayesian"
            ? latest.bayesBpm
            : latest.functionSettings.bpm,
        );
        refreshTransport();
      }
    } catch (e) {
      notify(e instanceof Error ? e.message : "Audio could not start.");
    } finally {
      if (serial === request.current) setBusy(false);
    }
  }
  const pianoDown = (pitch: number) => {
    if (heldRef.current.has(pitch)) return;
    heldRef.current.add(pitch);
    setHeld([...heldRef.current]);
    setFundamental(pitch);
    void engine
      .labNoteOn(lab.fourier, pitch, lab.fourierVolume)
      .catch((e) => notify(String(e)));
  };
  const pianoUp = (pitch: number) => {
    heldRef.current.delete(pitch);
    setHeld([...heldRef.current]);
    engine.labNoteOff(pitch);
  };
  const posterior = posteriorFor(lab.bayesModel, lab.bayesContext),
    sampling = samplingFor(lab.bayesModel, lab.bayesContext, lab.exploration);
  const candidates = SCALE_INTERVALS[lab.bayesContext.scale].map(
    (p) => 60 + lab.bayesContext.root + p,
  );
  function setContext(values: Partial<BayesContext>) {
    stop();
    setPending(null);
    setEvidence("");
    patch({ bayesContext: { ...lab.bayesContext, ...values } });
  }
  function learn(degree: number, context: BayesContext, accepted: boolean) {
    stop();
    const before = posteriorFor(lab.bayesModel, context)[degree];
    const model = feedback(lab.bayesModel, context, degree, accepted);
    const after = posteriorFor(model, context)[degree];
    const pitch = 60 + context.root + SCALE_INTERVALS[context.scale][degree];
    setEvidence(
      accepted
        ? `Accepted ${noteName(pitch)}: ${(before * 100).toFixed(1)}% → ${(after * 100).toFixed(1)}% in context ${contextKey(context)}. One observation added.`
        : `Rejected ${noteName(pitch)}: the posterior stays ${(after * 100).toFixed(1)}%. Its sampling weight is reduced for this context; no negative count is added.`,
    );
    if (accepted) {
      const pattern = structuredClone(lab.bayesPattern);
      const nextTick = pattern.notes.reduce(
        (end, note) => Math.max(end, note.startTick + 240),
        0,
      );
      if (nextTick < lab.bayesLength * 240)
        pattern.notes.push(createNote(pitch, nextTick, 210, 0.75));
      patch({
        bayesModel: model,
        bayesPattern: pattern,
        bayesContext: { ...context, previous: degree },
      });
    } else patch({ bayesModel: model });
    setPending(null);
  }
  function changeTab(tab: typeof lab.tab) {
    stop();
    setPending(null);
    setTab(tab);
  }
  const playback = (pattern: Pattern, bpm: number, invalid = false) => (
    <div className="lab-playback">
      <button
        className="button"
        disabled={invalid || !pattern.notes.length || busy}
        onClick={() => void preview(pattern, bpm)}
      >
        <Play size={14} />
        {busy ? "Preparing…" : "Play melody"}
      </button>
      <button className="button" onClick={stop}>
        <Square size={13} />
        Stop
      </button>
      <label className="lab-inline">
        Sound
        <select
          aria-label="Melody sound"
          value={lab.sound}
          onChange={(e) => {
            patch({ sound: e.target.value as "keys" | "fourier" });
          }}
        >
          <option value="keys">Electric Piano</option>
          <option value="fourier">Current Fourier sound</option>
        </select>
      </label>
      <button
        className="button primary"
        disabled={invalid || !pattern.notes.length}
        onClick={() => {
          stop();
          onAdd(pattern, sound, bpm);
        }}
      >
        <Plus size={14} />
        Add to Studio
      </button>
      <span className="lab-play-state" role="status">
        {previewing ? "Looping preview" : "Ready when you are"}
      </span>
    </div>
  );
  return (
    <main className="workspace math-lab" aria-label="Mathematical Music Lab">
      <header className="lab-heading">
        <div>
          <span className="eyebrow">EXPERIMENT / LISTEN / COMPOSE</span>
          <h1>
            Mathematical <em>Music Lab.</em>
          </h1>
          <p>
            Find a phrase in a curve. A voice in its harmonics. A new direction
            in probability.
          </p>
        </div>
        <SessionArtwork large />
        <button
          className="button small"
          onClick={() => {
            stop();
            onStudio();
          }}
        >
          <ArrowLeft size={13} />
          Studio
        </button>
      </header>
      <div className="lab-tabs" role="tablist" aria-label="Math Lab tools">
        {(["functions", "fourier", "bayesian"] as const).map((tab, i) => (
          <button
            key={tab}
            id={`tab-${tab}`}
            role="tab"
            aria-selected={lab.tab === tab}
            aria-controls={`panel-${tab}`}
            tabIndex={lab.tab === tab ? 0 : -1}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                e.preventDefault();
                const next = (["functions", "fourier", "bayesian"] as const)[
                  (i + (e.key === "ArrowRight" ? 1 : 2)) % 3
                ];
                changeTab(next);
                document.getElementById(`tab-${next}`)?.focus();
              }
            }}
            onClick={() => changeTab(tab)}
          >
            <span>0{i + 1}</span>
            {tab[0].toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>
      <nav className="lab-first-phrase" aria-label="Create your first phrase">
        {[
          {
            title: "Shape a curve",
            description: "Drag the notes into a contour",
            tab: "functions",
          },
          {
            title: "Choose a sound",
            description: "Shape eight real harmonics",
            tab: "fourier",
          },
          {
            title: "Preview & add",
            description: "Bring your phrase into Studio",
            tab: "functions",
          },
        ].map((step, index) => (
          <button
            key={step.title}
            aria-current={lab.flowStep === index + 1 ? "step" : undefined}
            onClick={() => {
              changeTab(step.tab as typeof lab.tab);
              patch({ flowStep: index + 1 });
              if (index === 2)
                requestAnimationFrame(() =>
                  document
                    .querySelector(".lab-sequence")
                    ?.scrollIntoView({ block: "center", behavior: "smooth" }),
                );
            }}
          >
            <span>{index + 1}</span>
            <div>
              <strong>{step.title}</strong>
              <small>{step.description}</small>
            </div>
          </button>
        ))}
      </nav>
      {lab.storageError && (
        <p className="lab-error" role="alert">
          {lab.storageError}
        </p>
      )}
      <div
        className="lab-content"
        role="tabpanel"
        id={`panel-${lab.tab}`}
        aria-labelledby={`tab-${lab.tab}`}
      >
        {lab.tab === "functions" && (
          <>
            <div className="lab-section-title">
              <div>
                <span className="eyebrow">01 / FUNCTION COMPOSER</span>
                <h2>A curve becomes a phrase.</h2>
              </div>
              <div className="lab-actions">
                <button
                  className="button"
                  disabled={!!evaluated.error || busy}
                  onClick={() =>
                    previewing
                      ? stop()
                      : void preview(
                          lab.functionPattern,
                          lab.functionSettings.bpm,
                        )
                  }
                >
                  {previewing ? <Square size={13} /> : <Play size={13} />}{" "}
                  {previewing ? "Stop shaping" : "Listen while shaping"}
                </button>
                <span className="lab-badge">16 steps · 2 bars</span>
              </div>
            </div>
            <div className="lab-composer-grid">
              <section className="lab-card lab-controls">
                <label>
                  Function preset
                  <select
                    aria-label="Function preset"
                    value={
                      FUNCTION_PRESETS.some(
                        (p) => p.value === lab.functionSettings.expression,
                      )
                        ? lab.functionSettings.expression
                        : "custom"
                    }
                    onChange={(e) =>
                      updateFunction({ expression: e.target.value })
                    }
                  >
                    <option value="custom" disabled>
                      Custom expression
                    </option>
                    {FUNCTION_PRESETS.map((p) => (
                      <option key={p.name} value={p.value}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  f(x)
                  <input
                    className="lab-expression"
                    aria-label="Function expression"
                    spellCheck={false}
                    value={lab.functionSettings.expression}
                    maxLength={256}
                    onChange={(e) =>
                      updateFunction({ expression: e.target.value })
                    }
                  />
                </label>
                <p className="lab-hint">
                  sin, cos, tan, exp, log, sqrt, abs · x, pi, e · + − * / ^
                </p>
                <Slider
                  label="Amplitude"
                  value={lab.functionSettings.amplitude}
                  min={0}
                  max={2}
                  step={0.05}
                  onChange={(amplitude) => updateFunction({ amplitude })}
                />
                <Slider
                  label="Frequency multiplier"
                  value={lab.functionSettings.frequency}
                  min={0.25}
                  max={8}
                  step={0.25}
                  onChange={(frequency) => updateFunction({ frequency })}
                />
                <Slider
                  label="Offset"
                  value={lab.functionSettings.offset}
                  min={-1}
                  max={1}
                  step={0.05}
                  onChange={(offset) => updateFunction({ offset })}
                />
                <p className="lab-hint">
                  The shape is normalized first. Amplitude widens its note
                  range; offset shifts its register.
                </p>
              </section>
              <section className="lab-card lab-graph-card">
                <div className="lab-card-heading">
                  <span>FUNCTION → PITCH CURVE</span>
                  <span>0–1 normalized · 16 samples</span>
                </div>
                <CurveEditor
                  points={curvePoints}
                  onChange={updateCurve}
                  onGesture={() => {
                    if (!previewing && !busy && !evaluated.error)
                      void preview(
                        lab.functionPattern,
                        lab.functionSettings.bpm,
                      );
                  }}
                />
                <p className="lab-hint">
                  Drag a point or use ↑ ↓ to change its pitch. Playback follows
                  the next notes without restarting.{" "}
                  {lab.functionCurve
                    ? "Custom piecewise-linear curve."
                    : "Normalized samples from your function."}
                </p>
                {evaluated.error ? (
                  <p className="lab-error" role="alert">
                    {evaluated.error}
                  </p>
                ) : (
                  <p className="lab-hint">
                    16 samples → normalized shape → scale degrees → playable
                    notes
                  </p>
                )}
                <div className="lab-context-controls">
                  <KeyScale
                    root={lab.functionSettings.root}
                    scale={lab.functionSettings.scale}
                    onChange={updateFunction}
                  />
                  <label>
                    Octave
                    <select
                      aria-label="Function octave"
                      value={lab.functionSettings.octave}
                      onChange={(e) =>
                        updateFunction({ octave: +e.target.value })
                      }
                    >
                      {[1, 2, 3, 4, 5, 6].map((n) => (
                        <option key={n}>{n}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Range
                    <select
                      aria-label="Octave range"
                      value={lab.functionSettings.octaves}
                      onChange={(e) =>
                        updateFunction({ octaves: +e.target.value })
                      }
                    >
                      {[1, 2, 3].map((n) => (
                        <option key={n} value={n}>
                          {n} octave{n > 1 ? "s" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Preview BPM
                    <input
                      aria-label="Function BPM"
                      type="number"
                      min={30}
                      max={300}
                      value={lab.functionSettings.bpm}
                      onChange={(e) =>
                        updateFunction({
                          bpm: Math.max(
                            30,
                            Math.min(300, +e.target.value || 80),
                          ),
                        })
                      }
                    />
                  </label>
                </div>
                <div className="lab-options">
                  <label>
                    <input
                      type="checkbox"
                      checked={lab.functionSettings.velocityMapping}
                      onChange={(e) =>
                        updateFunction({ velocityMapping: e.target.checked })
                      }
                    />
                    Map values to velocity
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={lab.functionSettings.density}
                      onChange={(e) =>
                        updateFunction({ density: e.target.checked })
                      }
                    />
                    Low values become rests
                  </label>
                </div>
              </section>
            </div>
            <section className="lab-card">
              <div className="lab-card-heading">
                <span>YOUR SEQUENCE / EDIT ANY STEP</span>
                <button
                  className="text-button"
                  disabled={!!evaluated.error}
                  onClick={() => updateFunction({})}
                >
                  <RotateCcw size={12} />
                  Reset notes from function
                </button>
              </div>
              <Sequence
                pattern={lab.functionPattern}
                pitches={scaleNotes(
                  lab.functionSettings.root,
                  lab.functionSettings.scale,
                  lab.functionSettings.octave,
                  lab.functionSettings.octaves,
                )}
                steps={16}
                onChange={(functionPattern) => {
                  patch({ functionPattern });
                }}
              />
              <button
                className="button small"
                onClick={continueCurve}
                disabled={
                  !!evaluated.error || !lab.functionPattern.notes.length
                }
              >
                Continue this curve with probability <ArrowUpRight size={13} />
              </button>
              {playback(
                lab.functionPattern,
                lab.functionSettings.bpm,
                !!evaluated.error,
              )}
            </section>
          </>
        )}
        {lab.tab === "fourier" && (
          <>
            <div className="lab-section-title">
              <div>
                <span className="eyebrow">02 / FOURIER SYNTHESIZER</span>
                <h2>Shape the sound from within.</h2>
              </div>
              <span className="lab-formula">x(t) = Σ Aₙ sin(2πnf₀t)</span>
            </div>
            <div className="lab-composer-grid">
              <section className="lab-card lab-controls">
                <label>
                  Sound preset
                  <select
                    aria-label="Fourier preset"
                    value={
                      FOURIER_PRESETS.some(
                        (p) => p.name === lab.fourier.presetName,
                      )
                        ? lab.fourier.presetName
                        : "custom"
                    }
                    onChange={(e) => {
                      const p = FOURIER_PRESETS.find(
                        (p) => p.name === e.target.value,
                      )!;
                      patch({
                        fourier: makeFourierInstrument(
                          p.harmonics,
                          p.name,
                          p.attack,
                          p.release,
                        ),
                      });
                    }}
                  >
                    <option value="custom" disabled>
                      Custom harmonics
                    </option>
                    {FOURIER_PRESETS.map((p) => (
                      <option key={p.name}>{p.name}</option>
                    ))}
                  </select>
                </label>
                <Slider
                  label="Fourier volume"
                  value={lab.fourierVolume}
                  min={0}
                  max={1}
                  step={0.01}
                  onChange={(fourierVolume) => patch({ fourierVolume })}
                />
                <Slider
                  label="Attack"
                  value={lab.fourier.attack}
                  min={0.005}
                  max={1}
                  step={0.005}
                  onChange={(attack) =>
                    patch({ fourier: { ...lab.fourier, attack } })
                  }
                />
                <Slider
                  label="Release"
                  value={lab.fourier.release}
                  min={0.02}
                  max={1.5}
                  step={0.01}
                  onChange={(release) =>
                    patch({ fourier: { ...lab.fourier, release } })
                  }
                />
                <p className="lab-hint">
                  Eight sine harmonics. All phases are zero. Levels are divided
                  by max(1, ΣA) to keep the sum bounded. Presets are synthesizer
                  approximations.
                </p>
              </section>
              <section className="lab-card lab-graph-card">
                <div className="lab-card-heading">
                  <span>COMPOSITE WAVEFORM</span>
                  <span>
                    {noteName(fundamental)} /{" "}
                    {midiToFrequency(fundamental).toFixed(1)} Hz
                  </span>
                </div>
                <Graph
                  values={waveformSamples(lab.fourier.harmonics ?? [])}
                  label="Fourier waveform"
                  fixed
                />
                <div className="lab-harmonics">
                  {Array.from({ length: 8 }, (_, i) => (
                    <label key={i}>
                      <span>H{i + 1}</span>
                      <div className="lab-harmonic-bar">
                        <i
                          style={{
                            height: `${(lab.fourier.harmonics?.[i] ?? 0) * 100}%`,
                          }}
                        />
                      </div>
                      <input
                        aria-label={`Harmonic ${i + 1}`}
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={lab.fourier.harmonics?.[i] ?? 0}
                        onChange={(e) => {
                          const harmonics = [
                            ...(lab.fourier.harmonics ?? Array(8).fill(0)),
                          ];
                          harmonics[i] = +e.target.value;
                          patch({
                            fourier: {
                              ...lab.fourier,
                              harmonics,
                              presetName: "Custom harmonics",
                            },
                          });
                        }}
                      />
                      <output>
                        {(lab.fourier.harmonics?.[i] ?? 0).toFixed(2)}
                      </output>
                    </label>
                  ))}
                </div>
              </section>
            </div>
            <section className="lab-card">
              <div className="lab-card-heading">
                <span>PLAY / HOLD A KEY, THEN SHAPE ITS HARMONICS</span>
                <button
                  className="button small"
                  onClick={() =>
                    heldRef.current.has(fundamental)
                      ? pianoUp(fundamental)
                      : pianoDown(fundamental)
                  }
                >
                  {held.includes(fundamental) ? "Release tone" : "Hold tone"}
                </button>
                <button className="button small" onClick={stop}>
                  <Square size={13} />
                  Stop all sound
                </button>
              </div>
              <div
                className="lab-keyboard"
                role="group"
                aria-label="Fourier keyboard"
              >
                {Array.from({ length: 13 }, (_, i) => i + 60).map((pitch) => (
                  <button
                    key={pitch}
                    className={`${[1, 3, 6, 8, 10].includes(pitch % 12) ? "black" : "white"} ${held.includes(pitch) ? "held" : ""}`}
                    aria-label={`Play ${noteName(pitch)}`}
                    aria-pressed={held.includes(pitch)}
                    onPointerDown={(e) => {
                      e.currentTarget.setPointerCapture(e.pointerId);
                      pianoDown(pitch);
                    }}
                    onPointerUp={() => pianoUp(pitch)}
                    onPointerCancel={() => pianoUp(pitch)}
                    onLostPointerCapture={() => pianoUp(pitch)}
                    onKeyDown={(e) => {
                      if ((e.key === " " || e.key === "Enter") && !e.repeat) {
                        e.preventDefault();
                        pianoDown(pitch);
                      }
                    }}
                    onKeyUp={(e) => {
                      if (e.key === " " || e.key === "Enter") {
                        e.preventDefault();
                        pianoUp(pitch);
                      }
                    }}
                    onBlur={() => pianoUp(pitch)}
                  >
                    <span>{noteName(pitch)}</span>
                  </button>
                ))}
              </div>
              <p className="lab-hint">
                Mouse / touch: hold and release. Keyboard: Tab to a key, then
                hold Space or Enter. Voices stop on focus loss.
              </p>
              <div className="lab-save-row">
                <button
                  className="button primary"
                  onClick={() => {
                    stop();
                    patch({ sound: "fourier", tab: "functions", flowStep: 3 });
                  }}
                >
                  Use this sound for my curve <ArrowUpRight size={13} />
                </button>
                <p className="lab-hint">
                  Your curve keeps its notes and now uses this sound.
                </p>
              </div>
              <div className="lab-save-row">
                <label>
                  Preset name
                  <input
                    aria-label="Preset name"
                    maxLength={80}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <button
                  className="button"
                  disabled={!name.trim()}
                  onClick={() => {
                    lab.savePreset(name, lab.fourier);
                    notify(
                      "Harmonic preset saved. Available in the Studio instrument selector.",
                    );
                  }}
                >
                  <Check size={14} />
                  Save sound
                </button>
                <label>
                  Saved sounds
                  <select
                    aria-label="Saved sounds"
                    value=""
                    onChange={(e) => {
                      const p = lab.savedPresets.find(
                        (p) => p.id === e.target.value,
                      );
                      if (p) patch({ fourier: structuredClone(p.instrument) });
                    }}
                  >
                    <option value="">Load a saved sound…</option>
                    {lab.savedPresets.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="lab-save-row">
                <label>
                  Destination track
                  <select
                    aria-label="Fourier destination"
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                  >
                    <option value="">New instrument track</option>
                    {project.tracks
                      .filter((t) => t.type === "midi")
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                  </select>
                </label>
                <button
                  className="button primary"
                  onClick={() => {
                    stop();
                    onApplyInstrument(lab.fourier, target || undefined);
                  }}
                >
                  <ArrowUpRight size={14} />
                  {target
                    ? "Apply sound to Studio"
                    : "Add instrument to Studio"}
                </button>
              </div>
            </section>
          </>
        )}
        {lab.tab === "bayesian" && (
          <>
            <div className="lab-section-title">
              <div>
                <span className="eyebrow">
                  03 / INTERACTIVE PROBABILITY COMPOSER
                </span>
                <h2>Let the next note learn.</h2>
              </div>
              <span className="lab-badge">Dirichlet–Categorical</span>
            </div>
            <div className="lab-composer-grid">
              <section className="lab-card lab-controls">
                <KeyScale
                  root={lab.bayesContext.root}
                  scale={lab.bayesContext.scale}
                  onChange={(values) =>
                    setContext({ ...values, chord: 0, previous: 0 })
                  }
                />
                <label>
                  Chord context
                  <select
                    aria-label="Chord context"
                    value={lab.bayesContext.chord}
                    onChange={(e) => setContext({ chord: +e.target.value })}
                  >
                    {candidates.map((p, i) => (
                      <option key={i} value={i}>
                        Degree {i + 1} · {noteName(p)} triad
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Previous note
                  <select
                    aria-label="Previous note"
                    value={lab.bayesContext.previous}
                    onChange={(e) => setContext({ previous: +e.target.value })}
                  >
                    {candidates.map((p, i) => (
                      <option key={i} value={i}>
                        {noteName(p)}
                      </option>
                    ))}
                  </select>
                </label>
                <Slider
                  label="Exploration"
                  value={lab.exploration}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={(exploration) => {
                    setPending(null);
                    patch({ exploration });
                  }}
                />
                <label>
                  Melody length
                  <select
                    aria-label="Melody length"
                    value={lab.bayesLength}
                    onChange={(e) => {
                      stop();
                      const length = +e.target.value;
                      const pattern = structuredClone(lab.bayesPattern);
                      pattern.lengthTicks = length * 240;
                      pattern.notes = pattern.notes
                        .filter((n) => n.startTick < pattern.lengthTicks)
                        .map((n) => ({
                          ...n,
                          durationTicks: Math.min(
                            n.durationTicks,
                            pattern.lengthTicks - n.startTick,
                          ),
                        }));
                      patch({ bayesLength: length, bayesPattern: pattern });
                    }}
                  >
                    {[8, 16, 32].map((n) => (
                      <option key={n} value={n}>
                        {n} notes
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Preview BPM
                  <input
                    aria-label="Bayesian BPM"
                    type="number"
                    min={30}
                    max={300}
                    value={lab.bayesBpm}
                    onChange={(e) => {
                      stop();
                      patch({
                        bayesBpm: Math.max(
                          30,
                          Math.min(300, +e.target.value || 80),
                        ),
                      });
                    }}
                  />
                </label>
              </section>
              <section className="lab-card">
                <div className="lab-card-heading">
                  <span>
                    NEXT NOTE / {ROOTS[lab.bayesContext.root]}{" "}
                    {lab.bayesContext.scale.toUpperCase()}
                  </span>
                  <span>
                    Σ P = {posterior.reduce((a, b) => a + b, 0).toFixed(3)}
                  </span>
                </div>
                <div className="lab-probabilities">
                  {candidates.map((pitch, i) => (
                    <button
                      className="lab-probability"
                      key={pitch}
                      aria-label={`Choose ${noteName(pitch)}`}
                      onClick={() => learn(i, { ...lab.bayesContext }, true)}
                    >
                      <span>{noteName(pitch)}</span>
                      <div>
                        <i style={{ width: `${posterior[i] * 100}%` }} />
                        <b style={{ left: `${sampling[i] * 100}%` }} />
                      </div>
                      <output>
                        {(posterior[i] * 100).toFixed(1)}%
                        <small>draw {(sampling[i] * 100).toFixed(1)}%</small>
                      </output>
                    </button>
                  ))}
                </div>
                <p className="lab-hint">
                  Filled bar = posterior probability. Marker = actual draw
                  probability after rejection preferences and exploration. Click
                  a note to choose and accept it.
                </p>
                <div className="lab-proposal">
                  <div>
                    <span className="eyebrow">NEXT SUGGESTION</span>
                    <strong>
                      {pending
                        ? noteName(
                            60 +
                              pending.context.root +
                              SCALE_INTERVALS[pending.context.scale][
                                pending.degree
                              ],
                          )
                        : "A note is waiting."}
                    </strong>
                  </div>
                  <button
                    className="button"
                    onClick={() =>
                      setPending({
                        degree: nextDegree(sampling),
                        context: { ...lab.bayesContext },
                      })
                    }
                  >
                    <RotateCcw size={13} />
                    {pending ? "Try another" : "Suggest next note"}
                  </button>
                  <button
                    className="button"
                    disabled={!pending}
                    onClick={() =>
                      pending && learn(pending.degree, pending.context, true)
                    }
                  >
                    <Check size={13} />
                    Accept
                  </button>
                  <button
                    className="button"
                    disabled={!pending}
                    onClick={() =>
                      pending && learn(pending.degree, pending.context, false)
                    }
                  >
                    <X size={13} />
                    Reject
                  </button>
                </div>
                <p className="lab-feedback" role="status">
                  {evidence ||
                    "Accept adds one observed choice to this context. Auto-generated notes never train the model."}
                </p>
                <details className="lab-explanation">
                  <summary>How the model listens</summary>
                  <p>
                    P(i | evidence) = (αᵢ + acceptedᵢ) / Σ(αⱼ + acceptedⱼ).
                    Priors are handcrafted tendencies toward nearby notes and
                    scale-degree triads, not learned training data. Context
                    includes root, scale, chord degree and previous degree.
                  </p>
                  <p>
                    Rejects apply exp(−0.35 × rejects) to drawing weights
                    (capped at 50 rejects for numerical stability). This is a
                    separate preference rule, not a conjugate Bayesian update.
                    Exploration mixes those weights with uniform probability. A
                    full melody still permits feedback; accepted notes are
                    appended only while space remains.
                  </p>
                  <button
                    className="button small"
                    onClick={() => {
                      patch({ bayesModel: {} });
                      setEvidence(
                        "Local evidence reset. Handcrafted priors remain.",
                      );
                      setPending(null);
                    }}
                  >
                    Reset learned preferences
                  </button>
                </details>
              </section>
            </div>
            <section className="lab-card">
              <div className="lab-card-heading">
                <span>
                  YOUR MELODY / {lab.bayesPattern.notes.length} OF{" "}
                  {lab.bayesLength} NOTES
                </span>
                <div className="lab-actions">
                  <button
                    className="button small"
                    onClick={() => {
                      stop();
                      const seed = (lab.seed + 1) % 2147483647;
                      patch({
                        bayesPattern: generateBayesianMelody(
                          lab.bayesContext,
                          lab.bayesModel,
                          lab.bayesLength,
                          lab.exploration,
                          seed,
                        ),
                        seed,
                      });
                      setPending(null);
                    }}
                  >
                    <RotateCcw size={13} />
                    Generate {lab.bayesLength} notes
                  </button>
                  <button
                    className="button small"
                    onClick={() => {
                      stop();
                      patch({
                        bayesPattern: {
                          ...createPattern("midi", lab.bayesLength * 240),
                          name: "Bayesian melody",
                        },
                      });
                      setPending(null);
                    }}
                  >
                    Clear melody
                  </button>
                </div>
              </div>
              <Sequence
                pattern={lab.bayesPattern}
                pitches={candidates}
                steps={lab.bayesLength}
                onChange={(bayesPattern) => {
                  stop();
                  patch({ bayesPattern });
                }}
              />
              {playback(lab.bayesPattern, lab.bayesBpm)}
            </section>
          </>
        )}
        <footer className="lab-footnote">
          <span>Made with mathematics. Finished by you.</span>
          <span>
            Add to Studio copies editable notes at the playhead. The session
            keeps its {project.transport.bpm} BPM tempo.
          </span>
        </footer>
      </div>
    </main>
  );
}
