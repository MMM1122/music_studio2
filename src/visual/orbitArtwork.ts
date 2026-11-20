/** Cached canvas artwork: all surface noise is generated on resize, never per frame. */
export const BLUE = { rim: "151,202,234", surface: [126, 177, 204] };
export const ROSE = { rim: "220,184,172", surface: [196, 153, 143] };
export type Palette = typeof BLUE;

export function random(seed: number) {
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

export function paintSky(width: number, height: number, dpr: number) {
  const { node, ctx } = layer(width, height, dpr);
  ctx.fillStyle = "#080d15";
  ctx.fillRect(0, 0, width, height);
  for (const [x, y, color] of [
    [0.32, 0.48, "51,93,126"],
    [0.73, 0.6, "113,72,81"],
  ] as const) {
    ctx.save();
    ctx.translate(x * width, y * height);
    ctx.scale(1, 0.55);
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, width * 0.5);
    glow.addColorStop(0, `rgba(${color},0.24)`);
    glow.addColorStop(0.45, `rgba(${color},0.08)`);
    glow.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(-width, -height * 2, width * 2, height * 4);
    ctx.restore();
  }
  const rand = random(17);
  for (let i = 0; i < (width * height) / 1000; i++) {
    const x = rand() * width,
      y = rand() * height;
    const size = 0.25 + rand() ** 4 * 0.7;
    ctx.fillStyle = `rgba(205,219,235,${0.12 + rand() * 0.48})`;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }
  // A little film grain keeps the gradients from feeling like a flat UI fill.
  for (let i = 0; i < (width * height) / 7; i++) {
    ctx.fillStyle = `rgba(174,195,212,${rand() * 0.025})`;
    ctx.fillRect(rand() * width, rand() * height, 1, 1);
  }
  return node;
}

function hash(x: number, y: number, z: number) {
  const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return n - Math.floor(n);
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function noise(x: number, y: number, z: number) {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    iz = Math.floor(z);
  const smooth = (n: number) => n * n * (3 - 2 * n);
  const u = smooth(x - ix),
    v = smooth(y - iy),
    w = smooth(z - iz);
  const plane = (k: number) =>
    lerp(
      lerp(hash(ix, iy, k), hash(ix + 1, iy, k), u),
      lerp(hash(ix, iy + 1, k), hash(ix + 1, iy + 1, k), u),
      v,
    );
  return lerp(plane(iz), plane(iz + 1), w);
}

/** Spherical normals, layered gas bands and a directional sun, with no specular plastic spot. */
export function paintPlanet(
  radius: number,
  palette: Palette,
  seed: number,
  dpr: number,
) {
  const { node, ctx } = layer(radius * 2 + 4, radius * 2 + 4, dpr);
  const pixels = ctx.createImageData(node.width, node.height);
  const pr = radius * dpr,
    cx = node.width / 2,
    cy = node.height / 2;
  for (let py = 0; py < node.height; py++) {
    for (let px = 0; px < node.width; px++) {
      const x = (px + 0.5 - cx) / pr,
        y = (py + 0.5 - cy) / pr;
      const distance = Math.hypot(x, y);
      if (distance > 1) continue;
      const z = Math.sqrt(1 - distance * distance);
      const warp = noise(x * 3 + seed, y * 3, z * 3);
      const bands = Math.sin(y * 34 + warp * 9 + x * 3);
      const detail = noise(x * 14 + seed, y * 28 + warp * 2, z * 14);
      const fine = noise(x * 50, y * 80 + seed, z * 50);
      const clouds = 0.76 + bands * 0.1 + detail * 0.22 + fine * 0.06;
      const light = Math.max(0, -x * 0.62 - y * 0.42 + z * 0.66);
      const diffuse = 0.09 + Math.pow(light, 0.85) * 0.91;
      const atmosphere = Math.pow(1 - z, 5) * (0.2 + light * 0.7);
      const i = (py * node.width + px) * 4;
      for (let c = 0; c < 3; c++) {
        const day = palette.surface[c] * clouds + light ** 3 * 38;
        pixels.data[i + c] = day * diffuse + atmosphere * (150 + c * 24);
      }
      pixels.data[i + 3] = Math.min(1, (1 - distance) * pr) * 255;
    }
  }
  ctx.putImageData(pixels, 0, 0);
  return node;
}

/** A fine dusty ring, split behind/in front of the moon to preserve its depth. */
export function paintRing(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  front: boolean,
  glow: number,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.34);
  for (let i = 0; i < 22; i++) {
    const r = radius * (1.38 + i * 0.022);
    ctx.strokeStyle = `rgba(${ROSE.rim},${(front ? 0.18 : 0.08) + (i % 4 === 0 ? 0.14 : 0) + glow * 0.1})`;
    ctx.lineWidth = i % 4 === 0 ? 0.65 : 0.35;
    ctx.beginPath();
    ctx.ellipse(
      0,
      0,
      r,
      r * 0.3,
      0,
      front ? 0 : Math.PI,
      front ? Math.PI : Math.PI * 2,
    );
    ctx.stroke();
  }
  ctx.restore();
}

/** Shared orbital plane. The broken far arc and brighter near arc read as one ellipse. */
export function paintOrbit(
  ctx: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  height: number,
  time: number,
  energy: number,
) {
  const x = (ax + bx) / 2,
    y = (ay + by) / 2;
  const rx = Math.max(45, (bx - ax) * 0.76),
    ry = height * 0.24;
  const rotation = -0.12;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  const gradient = ctx.createLinearGradient(-rx, 0, rx, 0);
  gradient.addColorStop(0, `rgba(${BLUE.rim},0.3)`);
  gradient.addColorStop(0.5, "rgba(179,198,214,0.05)");
  gradient.addColorStop(1, `rgba(${ROSE.rim},0.3)`);
  ctx.strokeStyle = gradient;
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "rgba(169,192,214,0.07)";
  ctx.setLineDash([2, 6]);
  ctx.beginPath();
  ctx.ellipse(0, 0, rx * 1.07, ry * 1.16, 0, Math.PI, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  for (let i = 0; i < 2; i++) {
    const angle = time * 0.09 + i * Math.PI + 0.5;
    const px = Math.cos(angle) * rx,
      py = Math.sin(angle) * ry;
    const light = ctx.createRadialGradient(px, py, 0, px, py, 5);
    light.addColorStop(0, `rgba(210,229,242,${0.5 + energy * 0.3})`);
    light.addColorStop(0.2, "rgba(183,212,234,0.2)");
    light.addColorStop(1, "rgba(183,212,234,0)");
    ctx.fillStyle = light;
    ctx.fillRect(px - 5, py - 5, 10, 10);
  }
  ctx.restore();
}
