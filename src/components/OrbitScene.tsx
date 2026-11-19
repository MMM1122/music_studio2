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

/** Ice blue for the upper voice, rose violet for the lower one. */
const BLUE = {
  light: "#cfe6ff",
  mid: "#4f7fae",
  dark: "#0b1a2e",
  rim: "150,200,255",
};
const ROSE = {
  light: "#f1d8f0",
  mid: "#8f6a9e",
  dark: "#1c1022",
  rim: "235,170,225",
};
type Palette = typeof BLUE;

function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function layer(width: number, height: number, dpr: number) {
  const node = document.createElement("canvas");
  node.width = Math.max(1, Math.ceil(width * dpr));
  node.height = Math.max(1, Math.ceil(height * dpr));
  const ctx = node.getContext("2d")!;
  ctx.scale(dpr, dpr);
  return { node, ctx };
}

/** Deep space: a near-black field, two faint nebulae and a fixed scatter of stars. */
function paintSky(width: number, height: number, dpr: number) {
  const { node, ctx } = layer(width, height, dpr);
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, "#05060b");
  sky.addColorStop(1, "#08090f");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);
  for (const [x, y, color] of [
    [0.28, 0.5, "70,120,180"],
    [0.74, 0.42, "170,100,160"],
  ] as const) {
    const glow = ctx.createRadialGradient(
      x * width,
      y * height,
      0,
      x * width,
      y * height,
      width * 0.42,
    );
    glow.addColorStop(0, `rgba(${color},0.09)`);
    glow.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
  }
  const rand = random(17);
  const count = Math.round((width * height) / 700);
  for (let i = 0; i < count; i++) {
    const size = rand() ** 3 * 1.1 + 0.25;
    ctx.fillStyle = `rgba(${rand() < 0.2 ? "210,220,255" : rand() < 0.1 ? "255,220,240" : "235,235,240"},${0.12 + rand() * 0.55})`;
    ctx.beginPath();
    ctx.arc(rand() * width, rand() * height, size, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 3; i++) {
    const x = (0.08 + rand() * 0.84) * width,
      y = (0.1 + rand() * 0.8) * height,
      reach = 5 + rand() * 6;
    const halo = ctx.createRadialGradient(x, y, 0, x, y, reach);
    halo.addColorStop(0, "rgba(255,255,255,0.8)");
    halo.addColorStop(0.2, "rgba(200,220,255,0.25)");
    halo.addColorStop(1, "rgba(200,220,255,0)");
    ctx.fillStyle = halo;
    ctx.fillRect(x - reach, y - reach, reach * 2, reach * 2);
    ctx.strokeStyle = "rgba(220,230,255,0.35)";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(x - reach * 1.4, y);
    ctx.lineTo(x + reach * 1.4, y);
    ctx.moveTo(x, y - reach * 1.4);
    ctx.lineTo(x, y + reach * 1.4);
    ctx.stroke();
  }
  const vignette = ctx.createRadialGradient(
    width / 2,
    height / 2,
    Math.min(width, height) * 0.3,
    width / 2,
    height / 2,
    Math.max(width, height) * 0.75,
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
  return node;
}

/** A lit sphere with cloud or band texture, rendered once per size. */
function paintPlanet(
  radius: number,
  palette: Palette,
  banded: boolean,
  seed: number,
  dpr: number,
) {
  const size = radius * 2;
  const { node, ctx } = layer(size, size, dpr);
  ctx.translate(radius, radius);
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.clip();
  const base = ctx.createRadialGradient(
    -radius * 0.35,
    -radius * 0.35,
    radius * 0.1,
    0,
    0,
    radius,
  );
  base.addColorStop(0, palette.light);
  base.addColorStop(0.45, palette.mid);
  base.addColorStop(1, palette.dark);
  ctx.fillStyle = base;
  ctx.fillRect(-radius, -radius, size, size);
  const rand = random(seed);
  if (banded)
    for (let i = 0; i < 16; i++) {
      const y = (rand() * 2 - 1) * radius,
        h = radius * (0.03 + rand() * 0.12);
      ctx.fillStyle =
        rand() < 0.5
          ? `rgba(255,230,250,${0.03 + rand() * 0.07})`
          : `rgba(40,10,50,${0.05 + rand() * 0.1})`;
      ctx.beginPath();
      ctx.ellipse(0, y, radius * 1.1, h, rand() * 0.12 - 0.06, 0, Math.PI * 2);
      ctx.fill();
    }
  for (let i = 0; i < (banded ? 8 : 46); i++) {
    const angle = rand() * Math.PI * 2,
      distance = Math.sqrt(rand()) * radius;
    ctx.fillStyle =
      rand() < 0.55
        ? `rgba(225,240,255,${0.03 + rand() * 0.08})`
        : `rgba(10,30,60,${0.05 + rand() * 0.1})`;
    ctx.beginPath();
    ctx.ellipse(
      Math.cos(angle) * distance,
      Math.sin(angle) * distance,
      radius * (0.05 + rand() * 0.3),
      radius * (0.03 + rand() * 0.12),
      rand() * Math.PI,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  // Night side toward the lower right, from a light up and to the left.
  const shade = ctx.createRadialGradient(
    -radius * 0.45,
    -radius * 0.4,
    radius * 0.2,
    -radius * 0.2,
    -radius * 0.2,
    radius * 1.55,
  );
  shade.addColorStop(0, "rgba(0,0,8,0)");
  shade.addColorStop(0.55, "rgba(0,0,8,0.25)");
  shade.addColorStop(1, "rgba(0,0,8,0.92)");
  ctx.fillStyle = shade;
  ctx.fillRect(-radius, -radius, size, size);
  const atmosphere = ctx.createRadialGradient(
    0,
    0,
    radius * 0.82,
    0,
    0,
    radius,
  );
  atmosphere.addColorStop(0, `rgba(${palette.rim},0)`);
  atmosphere.addColorStop(1, `rgba(${palette.rim},0.45)`);
  ctx.fillStyle = atmosphere;
  ctx.fillRect(-radius, -radius, size, size);
  return node;
}

const toGlow = (peak: number) =>
  Math.max(0, Math.min(1, (20 * Math.log10(Math.max(1e-6, peak)) + 42) / 36));
const ease = (current: number, next: number, dt: number) =>
  current + (next - current) * (1 - Math.exp(-dt * (next > current ? 14 : 3)));

/** "Twin resonance": two planets that each follow a melodic line, drift with inertia and glow with
 * loudness. Drawn on a canvas so the rest of the interface never re-renders for it. */
export function OrbitScene() {
  const figure = useRef<HTMLElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    names = useRef<HTMLSpanElement>(null),
    status = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const node = canvas.current!,
      ctx = node.getContext("2d");
    if (!ctx) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
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
      radiusA = Math.max(12, Math.min(70, height * 0.2));
      radiusB = radiusA * 0.64;
      sky = paintSky(width, height, dpr);
      blue = paintPlanet(radiusA, BLUE, false, 7, dpr);
      rose = paintPlanet(radiusB, ROSE, true, 23, dpr);
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
        const label = score.voices.length
          ? score.voices.map((v) => v.name).join(" · ")
          : "Room for resonance";
        if (names.current) names.current.textContent = label;
        figure.current?.setAttribute(
          "data-voices",
          score.voices.map((v) => v.name).join("|"),
        );
      }
      const playing = engine.isPlaying(),
        tick = engine.getTick();
      const targets = orbitTargets(score, tick, playing && !reduced);
      const seconds = time / 1000,
        drift = reduced ? 0 : 1;
      // Gentle Lissajous drift on top of the musical target, so paths curve rather than slide.
      const tax = targets.a.x + drift * 0.012 * Math.sin(seconds * 0.23),
        tay = targets.a.y + drift * 0.035 * Math.sin(seconds * 0.31 + 1),
        tbx = targets.b.x + drift * 0.012 * Math.sin(seconds * 0.19 + 2),
        tby = targets.b.y + drift * 0.035 * Math.sin(seconds * 0.27 + 4);
      [a.x, a.vx] = springStep(a.x, a.vx, tax, dt);
      [a.y, a.vy] = springStep(a.y, a.vy, tay, dt);
      [b.x, b.vx] = springStep(b.x, b.vx, tbx, dt);
      [b.y, b.vy] = springStep(b.y, b.vy, tby, dt);
      engine.readAnalysis(wave, spectrum);
      let sum = 0;
      for (const v of wave) sum += v * v;
      const rms = Math.sqrt(sum / wave.length);
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
      glowWave = ease(glowWave, toGlow(rms * 1.4), dt);
      const quiet = !playing && glowA + glowB + glowWave < 0.01;
      // Between takes the planets only drift slowly, so a lower frame rate is enough.
      if (time - lastDraw < (reduced ? 100 : quiet ? 33 : 0)) return;
      lastDraw = time;
      if (!sky || !blue || !rose) return;

      const w = width,
        h = height;
      let ax = a.x * w,
        bx = b.x * w;
      const ay = Math.max(radiusA + 4, Math.min(h - radiusA - 4, a.y * h)),
        by = Math.max(radiusB + 4, Math.min(h - radiusB - 4, b.y * h));
      const minimum = (radiusA + radiusB) * 1.15;
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
      const swing = h * 0.16 * glowWave;
      comb(
        bridge,
        (i, u) =>
          (Math.abs(wave[(crossing + i * 9) % wave.length]) /
            Math.max(0.05, peak)) *
            swing *
            Math.sin(Math.PI * u) ** 1.2 +
          h * 0.006 * (0.5 + 0.5 * Math.sin(i * 1.7 + seconds * 2)),
        link,
        0.35 + 0.6 * glowWave,
      );
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
            const bin =
              spectrum[Math.min(511, 2 + Math.round((1 - u) * 120))] / 255;
            const envelope = Math.exp(-(((u - 0.45) / 0.2) ** 2));
            return (
              envelope *
              (h * 0.01 + bin * h * 0.14 * (0.3 + 0.7 * glow)) *
              (0.55 + 0.45 * Math.abs(Math.sin(i * 2.3 + offset)))
            );
          },
          `rgba(${palette.rim},1)`,
          0.25 + 0.55 * glow,
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
            ctx!.strokeStyle = `rgba(${palette.rim},${(i / trail.length) ** 2 * 0.5})`;
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
        const reach = r * (1.5 + 0.9 * glow);
        const halo = ctx!.createRadialGradient(x, y, r * 0.8, x, y, reach);
        halo.addColorStop(0, `rgba(${palette.rim},${0.16 + 0.4 * glow})`);
        halo.addColorStop(1, `rgba(${palette.rim},0)`);
        ctx!.fillStyle = halo;
        ctx!.fillRect(x - reach, y - reach, reach * 2, reach * 2);
      }
      ctx!.globalCompositeOperation = "source-over";
      ctx!.drawImage(
        blue,
        ax - radiusA,
        ay - radiusA,
        radiusA * 2,
        radiusA * 2,
      );
      ctx!.drawImage(
        rose,
        bx - radiusB,
        by - radiusB,
        radiusB * 2,
        radiusB * 2,
      );
      ctx!.globalCompositeOperation = "lighter";
      for (const [x, y, r, palette, glow] of [
        [ax, ay, radiusA, BLUE, glowA],
        [bx, by, radiusB, ROSE, glowB],
      ] as const) {
        ctx!.strokeStyle = `rgba(${palette.rim},${0.1 + 0.4 * glow})`;
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
              ? "Two bodies · at rest"
              : state === "resonance"
                ? "Two bodies · in resonance"
                : "Two bodies · in orbit";
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
    };
  }, []);
  return (
    <figure
      ref={figure}
      className="orbit-scene"
      data-state="rest"
      aria-label="Twin resonance visualization"
    >
      <canvas
        ref={canvas}
        role="img"
        aria-label="Two planets, one for each main melodic line. They drift closer when the lines move near in pitch, apart when they spread, glow with loudness and settle between phrases."
      />
      <figcaption>
        <span ref={names}>Room for resonance</span>
        <span ref={status}>Two bodies · at rest</span>
      </figcaption>
    </figure>
  );
}
