/**
 * The 2D canvas Orbit, kept as the fallback for browsers without WebGL2 float render
 * targets: two cached spiral sprites that drift with the melodic voices and a tidal bridge.
 */
import { orbitTargets, springStep, type OrbitTargets } from "./orbit";
import {
  paintSky,
  paintGalaxy,
  paintTidalBridge,
  drawGalaxy,
} from "./orbitArtwork";

export interface LegacyFrame {
  targets: OrbitTargets;
  glowA: number;
  glowB: number;
  glowWave: number;
  wave: Float32Array;
}

export function createLegacyRenderer(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const galaxyA = paintGalaxy(7),
    galaxyB = paintGalaxy(23, true),
    bridge = paintTidalBridge();
  const start = orbitTargets({ voices: [], closest: 0, widest: 12 }, 0, false);
  const a = { x: start.a.x, y: start.a.y, vx: 0, vy: 0 },
    b = { x: start.b.x, y: start.b.y, vx: 0, vy: 0 };
  let sky: HTMLCanvasElement | null = null,
    skyKey = "";
  return {
    /** Advances the drift by `dt` and draws; `reduced` draws the fixed resting still. */
    draw(
      frame: LegacyFrame,
      dt: number,
      seconds: number,
      reduced: boolean,
      width: number,
      height: number,
      dpr: number,
    ) {
      const key = `${width}x${height}@${dpr}`;
      if (key !== skyKey) {
        sky = paintSky(width, height, dpr);
        skyKey = key;
      }
      const position = reduced ? start : frame.targets;
      const drift = reduced ? 0 : 1;
      const tx = position.a.x + drift * 0.01 * Math.sin(seconds * 0.18),
        ty = position.a.y;
      const ux = position.b.x + drift * 0.01 * Math.sin(seconds * 0.16 + 2),
        uy = position.b.y;
      let glowA = frame.glowA,
        glowB = frame.glowB,
        glowWave = frame.glowWave;
      if (reduced) {
        Object.assign(a, { x: tx, y: ty, vx: 0, vy: 0 });
        Object.assign(b, { x: ux, y: uy, vx: 0, vy: 0 });
        glowA = glowB = glowWave = 0;
      } else {
        [a.x, a.vx] = springStep(a.x, a.vx, tx, dt);
        [a.y, a.vy] = springStep(a.y, a.vy, ty, dt);
        [b.x, b.vx] = springStep(b.x, b.vx, ux, dt);
        [b.y, b.vy] = springStep(b.y, b.vy, uy, dt);
      }
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
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.drawImage(sky!, 0, 0, width, height);
      ctx.save();
      ctx.translate(ax, ay);
      ctx.rotate(angle);
      ctx.globalAlpha = 0.65 + glowWave * 0.35;
      const bridgeHeight = Math.min(field * 0.5, distance * 0.22);
      ctx.drawImage(bridge, 0, -bridgeHeight / 2, distance, bridgeHeight);
      ctx.restore();
      const s = reduced ? 0 : seconds;
      drawGalaxy(
        ctx,
        galaxyA,
        ax,
        ay,
        radiusA,
        0.51,
        -0.19,
        0.9 + s * 0.018,
        glowA,
      );
      drawGalaxy(
        ctx,
        galaxyB,
        bx,
        by,
        radiusB,
        0.65,
        -0.42,
        -0.6 - s * 0.024,
        glowB,
      );
      // Music is a fine ripple inside the tidal stream, not a line across the whole sky.
      if (glowWave > 0.01 && !reduced) {
        ctx.save();
        ctx.translate(ax, ay);
        ctx.rotate(angle);
        const color = ctx.createLinearGradient(0, 0, distance, 0);
        color.addColorStop(0, "rgba(239,208,167,0)");
        color.addColorStop(0.3, "rgba(173,212,246,0.4)");
        color.addColorStop(0.7, "rgba(173,212,246,0.4)");
        color.addColorStop(1, "rgba(239,208,167,0)");
        ctx.strokeStyle = color;
        ctx.lineWidth = 0.6;
        ctx.globalAlpha = glowWave * 0.6;
        ctx.beginPath();
        for (let i = 0; i < 100; i++) {
          const u = i / 99,
            y =
              (Math.sin(u * Math.PI * 2) * field * 0.07 +
                frame.wave[i * 8] * field * 0.11) *
              Math.sin(u * Math.PI);
          if (i) ctx.lineTo(u * distance, y);
          else ctx.moveTo(0, y);
        }
        ctx.stroke();
        ctx.restore();
      }
    },
  };
}
