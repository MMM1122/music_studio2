import { useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { engine } from "../audio/engine";
import type { ReferenceMode } from "../audio/scheduler";
import type { Project } from "../domain/models";
import { useProjectStore } from "../stores/projectStore";
import { chooseVoices, orbitTargets, type OrbitScore } from "../visual/orbit";
import {
  BinaryOrbit,
  HEAL_PLAYING,
  HEAL_RESTING,
  createGalaxies,
  duetSpecs,
  placeStars,
  stepGalaxies,
  zoomFor,
  type MusicState,
} from "../visual/binary";
import {
  createGalaxyRenderer,
  frameView,
  supportsGalaxyGL,
  type GalaxyRenderer,
} from "../visual/galaxyGL";
import { createLegacyRenderer } from "../visual/orbitLegacy";

const toGlow = (peak: number) =>
  Math.max(0, Math.min(1, (20 * Math.log10(Math.max(1e-6, peak)) + 42) / 36));
const ease = (current: number, next: number, dt: number) =>
  current + (next - current) * (1 - Math.exp(-dt * (next > current ? 12 : 3)));
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** Separation range of `orbitTargets`, used to read how close the voices are in pitch. */
const NEAR = 0.13,
  FAR = 0.56;

type Renderer = "webgl" | "canvas";

/** A binary pair of galaxies following the duet's two outer voices. With WebGL2, tens of
 * thousands of simulated stars orbit, are drawn out by each other's tide as the music pulls
 * the pair together, and heal at rest; otherwise two painted spirals drift with the voices. */
export function OrbitScene() {
  const figure = useRef<HTMLElement>(null),
    canvas = useRef<HTMLCanvasElement>(null);
  const upperName = useRef<HTMLSpanElement>(null),
    lowerName = useRef<HTMLSpanElement>(null),
    status = useRef<HTMLSpanElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState("");
  const [renderer, setRenderer] = useState<Renderer>(() =>
    supportsGalaxyGL() ? "webgl" : "canvas",
  );
  useEffect(() => {
    const changed = () =>
      setFullscreen(document.fullscreenElement === figure.current);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  async function toggleFullscreen() {
    try {
      setFullscreenError("");
      if (document.fullscreenElement === figure.current)
        await document.exitFullscreen();
      else await figure.current?.requestFullscreen();
    } catch {
      setFullscreenError("Expanded view is unavailable in this browser.");
    }
  }
  useEffect(() => {
    const node = canvas.current!;
    // Fewer stars on modest machines; the look holds from about 60% of the full count.
    const specs = duetSpecs(
      (navigator.hardwareConcurrency ?? 8) <= 4 ? 0.6 : 1,
    );
    let gl: GalaxyRenderer | null = null,
      legacy: ReturnType<typeof createLegacyRenderer> = null;
    const stars = renderer === "webgl" ? createGalaxies(specs) : null;
    if (stars) {
      try {
        gl = createGalaxyRenderer(node, stars);
      } catch {
        gl = null;
      }
      if (!gl) {
        // The canvas now belongs to WebGL; a fresh one takes the 2D fallback.
        setRenderer("canvas");
        return;
      }
    } else {
      legacy = createLegacyRenderer(node);
      if (!legacy) return;
    }
    figure.current?.setAttribute("data-renderer", renderer);
    const orbit = new BinaryOrbit();
    // The resting still for reduced motion: calm spirals at the starting phase.
    const still = stars ? new Float32Array(stars.world) : null;
    const stillA = [...orbit.coreA] as typeof orbit.coreA,
      stillB = [...orbit.coreB] as typeof orbit.coreB;
    if (stars) {
      stepGalaxies(stars, specs, orbit, 0, 0, 0);
      still!.set(stars.world);
    }

    const motionPreference = matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = motionPreference.matches,
      needsDraw = true;
    const onMotionChange = () => {
      reduced = motionPreference.matches;
      needsDraw = true;
    };
    motionPreference.addEventListener("change", onMotionChange);
    const wave = new Float32Array(1024),
      spectrum = new Uint8Array(512);
    let width = 0,
      height = 0,
      dpr = 1;
    let score: OrbitScore = { voices: [], closest: 0, widest: 12 },
      scored: Project | null = null,
      scoredMode: ReferenceMode | null = null;
    let glowA = 0,
      glowB = 0,
      glowWave = 0,
      closeness = 0,
      frame = 0,
      last = 0,
      lastDraw = 0,
      elapsed = 0,
      simulated = 0,
      pending = 0,
      visible = true,
      caption = "";

    function measure() {
      const rect = node.getBoundingClientRect(),
        ratio = Math.min(2, devicePixelRatio || 1);
      const w = Math.max(1, rect.width),
        h = Math.max(1, rect.height);
      if (w === width && h === height && ratio === dpr) return;
      width = w;
      height = h;
      dpr = ratio;
      node.width = Math.round(width * dpr);
      node.height = Math.round(height * dpr);
      needsDraw = true;
    }

    function draw(time: number) {
      frame = requestAnimationFrame(draw);
      const dt = Math.min(0.05, last ? (time - last) / 1000 : 0.016);
      last = time;
      if (!visible || document.hidden) return;
      const project = useProjectStore.getState().project,
        mode = engine.getReferenceMode();
      if (project !== scored || mode !== scoredMode) {
        score = chooseVoices(project, mode);
        scored = project;
        scoredMode = mode;
        if (upperName.current)
          upperName.current.textContent =
            score.voices[0]?.name ?? "Add a melodic track";
        if (lowerName.current)
          lowerName.current.textContent =
            score.voices[1]?.name ?? "Room for another voice";
        figure.current?.setAttribute(
          "data-voice-count",
          String(score.voices.length),
        );
        figure.current?.setAttribute(
          "data-voices",
          score.voices.map((v) => v.name).join("|"),
        );
      }
      const playing = engine.isPlaying(),
        targets = orbitTargets(score, engine.getTick(), playing);
      if (!reduced) {
        engine.readAnalysis(wave, spectrum);
        let sum = 0;
        for (const v of wave) sum += v * v;
        const [upper, lower] = score.voices;
        glowA = ease(
          glowA,
          upper ? toGlow(engine.getTrackLevel(upper.trackId)) : 0,
          dt,
        );
        glowB = ease(
          glowB,
          lower ? toGlow(engine.getTrackLevel(lower.trackId)) : 0,
          dt,
        );
        glowWave = ease(
          glowWave,
          toGlow(Math.sqrt(sum / wave.length) * 1.4),
          dt,
        );
        // How close the two voices are in pitch, read through the existing interval model.
        closeness +=
          (clamp01((FAR - targets.separation) / (FAR - NEAR)) - closeness) *
          (1 - Math.exp(-dt / 0.6));
      }
      if (stars) {
        const music: MusicState = {
          playing,
          closeness,
          energy: glowWave,
          rest: targets.rest,
          // Each core rises a little with its voice's register.
          liftA: (0.5 - targets.a.y) / 0.24,
          liftB: (0.5 - targets.b.y) / 0.24,
        };
        if (!reduced) {
          orbit.step(dt, music);
          // Stars move slowly, so the simulation runs at 30 Hz; frames in between only
          // carry each galaxy along with its core.
          pending += dt;
          if (pending >= 1 / 32) {
            simulated += pending;
            stepGalaxies(
              stars,
              specs,
              orbit,
              simulated,
              pending,
              HEAL_PLAYING + (HEAL_RESTING - HEAL_PLAYING) * orbit.calm,
            );
            pending = 0;
          } else placeStars(stars, orbit);
        }
      }
      const state =
        !playing || targets.rest > 0.8
          ? "rest"
          : stars
            ? orbit.distance < 1.35
              ? "resonance"
              : "orbit"
            : targets.separation < 0.24
              ? "resonance"
              : "orbit";
      if (state !== caption) {
        caption = state;
        figure.current?.setAttribute("data-state", state);
        if (status.current)
          status.current.textContent =
            state === "rest"
              ? "At rest"
              : state === "resonance"
                ? "In resonance"
                : "In orbit";
      }
      figure.current?.setAttribute(
        "data-separation",
        (stars ? orbit.distance : targets.separation).toFixed(2),
      );
      // With reduced motion, the still is redrawn only for resize/preference changes.
      if (reduced && !needsDraw) return;
      if (!reduced) elapsed += dt;
      if (!needsDraw && time - lastDraw < (playing ? 16 : 33)) return;
      lastDraw = time;
      needsDraw = false;
      if (gl) {
        gl.draw(
          frameView(width, height, dpr, reduced ? 1 : zoomFor(orbit.distance)),
          reduced ? still! : stars!.world,
          reduced ? stillA : orbit.coreA,
          reduced ? stillB : orbit.coreB,
          reduced
            ? { glowA: 0, glowB: 0, energy: 0 }
            : { glowA, glowB, energy: glowWave },
        );
      } else
        legacy!.draw(
          { targets, glowA, glowB, glowWave, wave },
          dt,
          elapsed,
          reduced,
          width,
          height,
          dpr,
        );
    }
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(node);
    const observer = new IntersectionObserver((entries) => {
      visible = entries[0]?.isIntersecting ?? true;
    });
    observer.observe(node);
    const lost = (event: Event) => {
      event.preventDefault();
      cancelAnimationFrame(frame);
    };
    node.addEventListener("webglcontextlost", lost);
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      observer.disconnect();
      node.removeEventListener("webglcontextlost", lost);
      motionPreference.removeEventListener("change", onMotionChange);
      gl?.dispose();
    };
  }, [renderer]);
  return (
    <figure
      ref={figure}
      className="orbit-scene"
      data-state="rest"
      aria-label="Twin resonance visualization"
    >
      <div className="orbit-overline">
        <span className="orbit-title">
          Twin resonance{" "}
          <span className="orbit-subtitle">/ A galactic duet</span>
        </span>
        <div className="orbit-actions">
          <span className="orbit-status">
            <i aria-hidden="true" />
            <span ref={status}>At rest</span>
          </span>
          {document.fullscreenEnabled && (
            <button
              className="orbit-expand"
              aria-label={fullscreen ? "Exit expanded orbit" : "Expand orbit"}
              title={fullscreen ? "Exit expanded orbit (Esc)" : "Expand orbit"}
              onClick={() => void toggleFullscreen()}
            >
              {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
          )}
        </div>
      </div>
      <canvas
        key={renderer}
        ref={canvas}
        role="img"
        aria-label="A binary pair of spiral galaxies with warm cores, dusty violet disks and blue, clumpy arms. They orbit each other and draw closer as the music builds and the two voices move nearer in pitch; close passes pull out tidal bridges and tails, which settle again when the music rests."
      />
      {fullscreenError && (
        <span className="orbit-error" role="status">
          {fullscreenError}
        </span>
      )}
      <figcaption>
        <span className="orbit-voice orbit-voice-upper">
          <i aria-hidden="true" />
          <span ref={upperName}>Add a melodic track</span>
        </span>
        <span className="orbit-caption">Two voices. A shared universe.</span>
        <span className="orbit-voice orbit-voice-lower">
          <i aria-hidden="true" />
          <span ref={lowerName}>Room for another voice</span>
        </span>
      </figcaption>
    </figure>
  );
}
