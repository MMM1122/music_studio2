import { useEffect, useRef } from "react";
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
  BLUE,
  ROSE,
  random,
  paintSky,
  paintPlanet,
  paintRing,
  paintOrbit,
  type Palette,
} from "../visual/orbitArtwork";

const toGlow = (peak: number) =>
  Math.max(0, Math.min(1, (20 * Math.log10(Math.max(1e-6, peak)) + 42) / 36));
const ease = (current: number, next: number, dt: number) =>
  current + (next - current) * (1 - Math.exp(-dt * (next > current ? 14 : 3)));

/** "Twin resonance": two planets that each follow a melodic line, drift with inertia and glow with
 * loudness. Drawn on a canvas so the rest of the interface never re-renders for it. */
export function OrbitScene() {
  const figure = useRef<HTMLElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    upperName = useRef<HTMLSpanElement>(null),
    lowerName = useRef<HTMLSpanElement>(null),
    status = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const node = canvas.current!,
      ctx = node.getContext("2d");
    if (!ctx) return;
    const motionPreference = matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = motionPreference.matches;
    const onMotionChange = () => {
      reduced = motionPreference.matches;
      trailA.length = trailB.length = 0;
      lastDraw = 0;
    };
    motionPreference.addEventListener("change", onMotionChange);
    const wave = new Float32Array(1024),
      spectrum = new Uint8Array(512);
    let width = 0,
      height = 0,
      dpr = 1,
      sky: HTMLCanvasElement | null = null,
      blue: HTMLCanvasElement | null = null,
      rose: HTMLCanvasElement | null = null,
      radiusA = 0,
      radiusB = 0;
    let score: OrbitScore = { voices: [], closest: 0, widest: 12 },
      scored: Project | null = null,
      scoredMode: ReferenceMode | null = null;
    const start = orbitTargets(score, 0, false);
    const a = { x: start.a.x, y: start.a.y, vx: 0, vy: 0 },
      b = { x: start.b.x, y: start.b.y, vx: 0, vy: 0 };
    const trailA: { x: number; y: number }[] = [],
      trailB: { x: number; y: number }[] = [];
    let glowA = 0,
      glowB = 0,
      glowWave = 0,
      frame = 0,
      last = 0,
      lastDraw = 0,
      visible = true,
      caption = "";
    const twinkles = Array.from({ length: 14 }, (_, i) => {
      const rand = random(101 + i);
      return {
        x: rand(),
        y: rand(),
        speed: 0.6 + rand() * 1.6,
        phase: rand() * 6.28,
      };
    });

    function measure() {
      const rect = node.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      dpr = Math.min(2, devicePixelRatio || 1);
      node.width = Math.round(width * dpr);
      node.height = Math.round(height * dpr);
      radiusA = Math.max(12, Math.min(58, height * 0.225, width * 0.09));
      radiusB = radiusA * 0.67;
      trailA.length = trailB.length = 0;
      sky = paintSky(width, height, dpr);
      blue = paintPlanet(radiusA, BLUE, 7, dpr);
      rose = paintPlanet(radiusB, ROSE, 23, dpr);
      lastDraw = 0;
    }

    /** Symmetric spiky waveform along a path, brightest where `envelope` peaks. */
    function comb(
      points: { x: number; y: number }[],
      heights: (index: number, u: number) => number,
      gradient: CanvasGradient | string,
      alpha: number,
    ) {
      ctx!.strokeStyle = gradient;
      ctx!.globalAlpha = alpha * 0.55;
      ctx!.lineWidth = 0.7;
      ctx!.beginPath();
      points.forEach((p, i) =>
        i ? ctx!.lineTo(p.x, p.y) : ctx!.moveTo(p.x, p.y),
      );
      ctx!.stroke();
      ctx!.globalAlpha = alpha;
      ctx!.lineWidth = 0.8;
      ctx!.beginPath();
      points.forEach((p, i) => {
        const h = heights(i, i / (points.length - 1));
        if (h < 0.4) return;
        ctx!.moveTo(p.x, p.y - h);
        ctx!.lineTo(p.x, p.y + h);
      });
      ctx!.stroke();
      ctx!.globalAlpha = 1;
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
        tick = engine.getTick();
      const targets = orbitTargets(score, tick, playing);
      const seconds = reduced ? 0 : time / 1000,
        drift = reduced ? 0 : 1;
      // Gentle Lissajous drift on top of the musical target, so paths curve rather than slide.
      const position = reduced ? start : targets;
      const tax = position.a.x + drift * 0.012 * Math.sin(seconds * 0.23),
        tay = position.a.y + drift * 0.035 * Math.sin(seconds * 0.31 + 1),
        tbx = position.b.x + drift * 0.012 * Math.sin(seconds * 0.19 + 2),
        tby = position.b.y + drift * 0.035 * Math.sin(seconds * 0.27 + 4);
      if (reduced) {
        Object.assign(a, { x: tax, y: tay, vx: 0, vy: 0 });
        Object.assign(b, { x: tbx, y: tby, vx: 0, vy: 0 });
      } else {
        [a.x, a.vx] = springStep(a.x, a.vx, tax, dt);
        [a.y, a.vy] = springStep(a.y, a.vy, tay, dt);
        [b.x, b.vx] = springStep(b.x, b.vx, tbx, dt);
        [b.y, b.vy] = springStep(b.y, b.vy, tby, dt);
      }
      engine.readAnalysis(wave, spectrum);
      let sum = 0;
      for (const v of wave) sum += v * v;
      const rms = Math.sqrt(sum / wave.length);
      const [upper, lower] = score.voices;
      glowA = ease(
        glowA,
        upper && !reduced ? toGlow(engine.getTrackLevel(upper.trackId)) : 0,
        dt,
      );
      glowB = ease(
        glowB,
        lower && !reduced ? toGlow(engine.getTrackLevel(lower.trackId)) : 0,
        dt,
      );
      glowWave = ease(glowWave, toGlow(rms * 1.4), dt);
      if (reduced) glowA = glowB = glowWave = 0;
      const quiet = !playing && glowA + glowB + glowWave < 0.01;
      // Between takes the planets only drift slowly, so a lower frame rate is enough.
      if (time - lastDraw < (reduced ? 100 : quiet ? 33 : 0)) return;
      lastDraw = time;
      if (!sky || !blue || !rose) return;

      const w = width,
        h = height;
      let ax = a.x * w,
        bx = b.x * w;
      const padding = Math.min(28, h * 0.18);
      const sceneHeight = h - padding * 2;
      const ay = padding + radiusA + (sceneHeight - radiusA * 2) * a.y,
        by = padding + radiusB + (sceneHeight - radiusB * 2) * b.y;
      const minimum = radiusA + radiusB * 1.85 + 14;
      if (bx - ax < minimum) {
        const mid = (ax + bx) / 2;
        ax = mid - minimum / 2;
        bx = mid + minimum / 2;
      }
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.globalCompositeOperation = "source-over";
      ctx!.drawImage(sky, 0, 0, w, h);
      if (!reduced)
        for (const star of twinkles) {
          ctx!.fillStyle = `rgba(230,236,255,${0.15 + 0.45 * (0.5 + 0.5 * Math.sin(seconds * star.speed + star.phase))})`;
          ctx!.fillRect(star.x * w, star.y * h, 1.1, 1.1);
        }

      paintOrbit(ctx!, ax, ay, bx, by, sceneHeight, seconds, glowWave);
      ctx!.globalCompositeOperation = "lighter";
      // Sound wave between the planets: a soft arc carrying the measured waveform.
      const fromX = ax + radiusA * 0.95,
        toX = bx - radiusB * 0.95;
      const sag = h * 0.05 * Math.sin(seconds * 0.4);
      let crossing = 0;
      for (let i = 1; i < 256; i++)
        if (wave[i - 1] <= 0 && wave[i] > 0) {
          crossing = i;
          break;
        }
      const bridge = Array.from({ length: 90 }, (_, i) => {
        const u = i / 89;
        return {
          x: fromX + (toX - fromX) * u,
          y:
            ay +
            (by - ay) * u +
            sag * Math.sin(Math.PI * u) +
            h * 0.008 * Math.sin(u * 14 - seconds * 1.3),
        };
      });
      const link = ctx!.createLinearGradient(fromX, ay, toX, by);
      link.addColorStop(0, `rgba(${BLUE.rim},1)`);
      link.addColorStop(1, `rgba(${ROSE.rim},1)`);
      // Peaks are normalized so the wave keeps its shape at any volume; loudness sets its size.
      let peak = 0;
      for (let i = 0; i < 90 * 9; i++)
        peak = Math.max(peak, Math.abs(wave[(crossing + i) % wave.length]));
      const swing = h * 0.065 * glowWave;
      // Three fine filaments share the real waveform. They resolve to one quiet line at rest.
      for (let strand = -1; strand <= 1; strand++) {
        ctx!.strokeStyle = link;
        ctx!.globalAlpha =
          strand === 0 ? 0.28 + glowWave * 0.45 : glowWave * 0.16;
        ctx!.lineWidth = strand === 0 ? 0.85 : 0.6;
        ctx!.beginPath();
        bridge.forEach((point, i) => {
          const u = i / (bridge.length - 1);
          const signal =
            wave[(crossing + i * 9) % wave.length] / Math.max(0.05, peak);
          const y =
            point.y +
            (signal * swing +
              strand * Math.sin(u * 12 - seconds) * swing * 0.5) *
              Math.sin(Math.PI * u);
          if (i) ctx!.lineTo(point.x, y);
          else ctx!.moveTo(point.x, y);
        });
        ctx!.stroke();
      }
      ctx!.globalAlpha = 1;
      // Outer tails: frequency energy fanning away from each planet toward the edges.
      const tail = (
        fromPlanetX: number,
        planetY: number,
        edgeX: number,
        palette: Palette,
        glow: number,
        offset: number,
      ) => {
        const points = Array.from({ length: 80 }, (_, i) => {
          const u = i / 79,
            k = u * u * (3 - 2 * u);
          return {
            x: edgeX + (fromPlanetX - edgeX) * u,
            y:
              h * 0.5 +
              (planetY - h * 0.5) * k +
              Math.sin(u * Math.PI * 2 + seconds * 0.3 + offset) *
                h *
                0.04 *
                (1 - u),
          };
        });
        comb(
          points,
          (i, u) => {
            const bin = reduced
              ? 0
              : spectrum[Math.min(511, 2 + Math.round((1 - u) * 120))] / 255;
            const envelope = Math.exp(-(((u - 0.45) / 0.2) ** 2));
            return (
              envelope *
              (h * 0.002 + bin * h * 0.07 * (0.3 + 0.7 * glow)) *
              (0.55 + 0.45 * Math.abs(Math.sin(i * 2.3 + offset)))
            );
          },
          `rgba(${palette.rim},1)`,
          0.08 + 0.35 * glow,
        );
      };
      tail(
        ax - radiusA * 0.95,
        ay,
        0,
        BLUE,
        Math.max(glowA, glowWave * 0.5),
        0,
      );
      tail(
        bx + radiusB * 0.95,
        by,
        w,
        ROSE,
        Math.max(glowB, glowWave * 0.5),
        3,
      );

      // Fading light trails behind each planet.
      if (!reduced) {
        trailA.push({ x: ax, y: ay });
        trailB.push({ x: bx, y: by });
        if (trailA.length > 70) trailA.shift();
        if (trailB.length > 70) trailB.shift();
        for (const [trail, palette] of [
          [trailA, BLUE],
          [trailB, ROSE],
        ] as const) {
          ctx!.lineWidth = 1.2;
          for (let i = 1; i < trail.length; i++) {
            ctx!.strokeStyle = `rgba(${palette.rim},${(i / trail.length) ** 2 * 0.18})`;
            ctx!.beginPath();
            ctx!.moveTo(trail[i - 1].x, trail[i - 1].y);
            ctx!.lineTo(trail[i].x, trail[i].y);
            ctx!.stroke();
          }
        }
      }

      // Halo grows with each voice's loudness.
      for (const [x, y, r, palette, glow] of [
        [ax, ay, radiusA, BLUE, glowA],
        [bx, by, radiusB, ROSE, glowB],
      ] as const) {
        const reach = r * (1.8 + 0.7 * glow);
        const halo = ctx!.createRadialGradient(x, y, r * 0.8, x, y, reach);
        halo.addColorStop(0, `rgba(${palette.rim},${0.07 + 0.16 * glow})`);
        halo.addColorStop(1, `rgba(${palette.rim},0)`);
        ctx!.fillStyle = halo;
        ctx!.fillRect(x - reach, y - reach, reach * 2, reach * 2);
      }
      ctx!.globalCompositeOperation = "source-over";
      paintRing(ctx!, bx, by, radiusB, false, glowB);
      ctx!.drawImage(
        blue,
        ax - radiusA - 2,
        ay - radiusA - 2,
        radiusA * 2 + 4,
        radiusA * 2 + 4,
      );
      ctx!.drawImage(
        rose,
        bx - radiusB - 2,
        by - radiusB - 2,
        radiusB * 2 + 4,
        radiusB * 2 + 4,
      );
      paintRing(ctx!, bx, by, radiusB, true, glowB);
      ctx!.globalCompositeOperation = "lighter";
      for (const [x, y, r, palette, glow] of [
        [ax, ay, radiusA, BLUE, glowA],
        [bx, by, radiusB, ROSE, glowB],
      ] as const) {
        ctx!.strokeStyle = `rgba(${palette.rim},${0.12 + 0.25 * glow})`;
        ctx!.lineWidth = 0.8 + 0.6 * glow;
        ctx!.beginPath();
        ctx!.arc(x, y, r - 0.5, -Math.PI * 0.95, Math.PI * 0.15);
        ctx!.stroke();
      }
      ctx!.globalCompositeOperation = "source-over";

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
        <span className="orbit-title">Twin resonance</span>
        <span className="orbit-status">
          <i aria-hidden="true" />
          <span ref={status}>At rest</span>
        </span>
      </div>
      <canvas
        ref={canvas}
        role="img"
        aria-label="Two planets, one for each main melodic line. They drift closer when the lines move near in pitch, apart when they spread, glow with loudness and settle between phrases."
      />
      <figcaption>
        <span className="orbit-voice orbit-voice-upper">
          <i aria-hidden="true" />
          <span ref={upperName}>Add a melodic track</span>
        </span>
        <span className="orbit-caption">
          Two voices. One gravitational pull.
        </span>
        <span className="orbit-voice orbit-voice-lower">
          <i aria-hidden="true" />
          <span ref={lowerName}>Room for another voice</span>
        </span>
      </figcaption>
    </figure>
  );
}
