import { useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { engine } from "../audio/engine";
import type { ReferenceMode } from "../audio/scheduler";
import type { Project } from "../domain/models";
import { useProjectStore } from "../stores/projectStore";
import {
  chooseVoices,
  orbitTargets,
  springStep,
  type OrbitScore,
} from "../visual/orbit";
import {
  paintSky,
  paintGalaxy,
  paintTidalBridge,
  drawGalaxy,
} from "../visual/orbitArtwork";

const toGlow = (peak: number) =>
  Math.max(0, Math.min(1, (20 * Math.log10(Math.max(1e-6, peak)) + 42) / 36));
const ease = (current: number, next: number, dt: number) =>
  current + (next - current) * (1 - Math.exp(-dt * (next > current ? 12 : 3)));

/** Two original spiral galaxies follow the outer melodic voices. Cached dust/stellar layers
 * keep the rendering independent of React and of the audio scheduling thread. */
export function OrbitScene() {
  const figure = useRef<HTMLElement>(null),
    canvas = useRef<HTMLCanvasElement>(null);
  const upperName = useRef<HTMLSpanElement>(null),
    lowerName = useRef<HTMLSpanElement>(null),
    status = useRef<HTMLSpanElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState("");
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
    const node = canvas.current!,
      ctx = node.getContext("2d");
    if (!ctx) return;
    const motionPreference = matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = motionPreference.matches,
      needsDraw = true;
    const onMotionChange = () => {
      reduced = motionPreference.matches;
      needsDraw = true;
    };
    motionPreference.addEventListener("change", onMotionChange);
    const galaxyA = paintGalaxy(7),
      galaxyB = paintGalaxy(23, true),
      bridge = paintTidalBridge();
    const wave = new Float32Array(1024),
      spectrum = new Uint8Array(512);
    let width = 0,
      height = 0,
      dpr = 1,
      sky: HTMLCanvasElement | null = null;
    let score: OrbitScore = { voices: [], closest: 0, widest: 12 },
      scored: Project | null = null,
      scoredMode: ReferenceMode | null = null;
    const start = orbitTargets(score, 0, false);
    const a = { x: start.a.x, y: start.a.y, vx: 0, vy: 0 },
      b = { x: start.b.x, y: start.b.y, vx: 0, vy: 0 };
    let glowA = 0,
      glowB = 0,
      glowWave = 0,
      frame = 0,
      last = 0,
      lastDraw = 0,
      elapsed = 0,
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
      sky = paintSky(width, height, dpr);
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
      const state =
        !playing || targets.rest > 0.8
          ? "rest"
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
        targets.separation.toFixed(2),
      );
      // With reduced motion, the cached still is redrawn only for resize/preference changes.
      if (reduced && !needsDraw) return;
      if (!reduced) elapsed += dt;
      const seconds = reduced ? 0 : elapsed;
      const position = reduced ? start : targets;
      const drift = reduced ? 0 : 1;
      const tx = position.a.x + drift * 0.01 * Math.sin(seconds * 0.18),
        ty = position.a.y;
      const ux = position.b.x + drift * 0.01 * Math.sin(seconds * 0.16 + 2),
        uy = position.b.y;
      if (reduced) {
        Object.assign(a, { x: tx, y: ty, vx: 0, vy: 0 });
        Object.assign(b, { x: ux, y: uy, vx: 0, vy: 0 });
        glowA = glowB = glowWave = 0;
      } else {
        [a.x, a.vx] = springStep(a.x, a.vx, tx, dt);
        [a.y, a.vy] = springStep(a.y, a.vy, ty, dt);
        [b.x, b.vx] = springStep(b.x, b.vx, ux, dt);
        [b.y, b.vy] = springStep(b.y, b.vy, uy, dt);
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
      }
      if (!needsDraw && time - lastDraw < (playing ? 16 : 40)) return;
      if (!sky) return;
      lastDraw = time;
      needsDraw = false;
      const padding = Math.min(64, height * 0.19),
        field = height - padding * 2;
      const radiusA = Math.min(field * 1.15, width * 0.245),
        radiusB = radiusA * 0.76;
      const ax = a.x * width,
        bx = b.x * width;
      // The centers may approach while the transparent arms overlap, like tidal interaction.
      const ay = height * 0.53 + (a.y - 0.5) * field * 0.32;
      const by = height * 0.45 + (b.y - 0.5) * field * 0.32;
      const distance = Math.hypot(bx - ax, by - ay),
        angle = Math.atan2(by - ay, bx - ax);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.globalCompositeOperation = "source-over";
      ctx!.globalAlpha = 1;
      ctx!.drawImage(sky, 0, 0, width, height);
      ctx!.save();
      ctx!.translate(ax, ay);
      ctx!.rotate(angle);
      ctx!.globalAlpha = 0.65 + glowWave * 0.35;
      const bridgeHeight = Math.min(field * 0.5, distance * 0.22);
      ctx!.drawImage(bridge, 0, -bridgeHeight / 2, distance, bridgeHeight);
      ctx!.restore();
      drawGalaxy(
        ctx!,
        galaxyA,
        ax,
        ay,
        radiusA,
        0.51,
        -0.19,
        0.9 + seconds * 0.018,
        glowA,
      );
      drawGalaxy(
        ctx!,
        galaxyB,
        bx,
        by,
        radiusB,
        0.65,
        -0.42,
        -0.6 - seconds * 0.024,
        glowB,
      );
      // Music is a fine ripple inside the tidal stream, not a line across the whole sky.
      if (glowWave > 0.01 && !reduced) {
        ctx!.save();
        ctx!.translate(ax, ay);
        ctx!.rotate(angle);
        const color = ctx!.createLinearGradient(0, 0, distance, 0);
        color.addColorStop(0, "rgba(239,208,167,0)");
        color.addColorStop(0.3, "rgba(173,212,246,0.4)");
        color.addColorStop(0.7, "rgba(173,212,246,0.4)");
        color.addColorStop(1, "rgba(239,208,167,0)");
        ctx!.strokeStyle = color;
        ctx!.lineWidth = 0.6;
        ctx!.globalAlpha = glowWave * 0.6;
        ctx!.beginPath();
        for (let i = 0; i < 100; i++) {
          const u = i / 99,
            y =
              (Math.sin(u * Math.PI * 2) * field * 0.07 +
                wave[i * 8] * field * 0.11) *
              Math.sin(u * Math.PI);
          if (i) ctx!.lineTo(u * distance, y);
          else ctx!.moveTo(0, y);
        }
        ctx!.stroke();
        ctx!.restore();
      }
    }
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(node);
    const observer = new IntersectionObserver((entries) => {
      visible = entries[0]?.isIntersecting ?? true;
    });
    observer.observe(node);
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      observer.disconnect();
      motionPreference.removeEventListener("change", onMotionChange);
    };
  }, []);
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
        ref={canvas}
        role="img"
        aria-label="Two intertwined spiral galaxies with warm luminous cores, blue stellar arms and a tidal bridge. Each follows a melodic voice: pitch shapes their positions, intervals their separation, and loudness their light."
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
