/** Original, deterministic galaxy artwork. Expensive star fields are cached, not drawn per frame. */
export function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function layer(width: number, height = width) {
  const node = document.createElement("canvas");
  node.width = Math.max(1, Math.round(width));
  node.height = Math.max(1, Math.round(height));
  return { node, ctx: node.getContext("2d")! };
}
const gaussian = (rand: () => number) => rand() + rand() + rand() + rand() - 2;

function glowSprite(color: string) {
  const { node, ctx } = layer(64);
  const light = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  light.addColorStop(0, `rgba(${color},0.8)`);
  light.addColorStop(0.1, `rgba(${color},0.36)`);
  light.addColorStop(0.35, `rgba(${color},0.07)`);
  light.addColorStop(1, `rgba(${color},0)`);
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, 64, 64);
  return node;
}

function star(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
) {
  const glow = ctx.createRadialGradient(x, y, 0, x, y, size * 7);
  glow.addColorStop(0, `rgba(${color},0.75)`);
  glow.addColorStop(0.13, `rgba(${color},0.25)`);
  glow.addColorStop(1, `rgba(${color},0)`);
  ctx.fillStyle = glow;
  ctx.fillRect(x - size * 7, y - size * 7, size * 14, size * 14);
  ctx.fillStyle = "#edf4ff";
  ctx.fillRect(x - size / 2, y - size / 2, size, size);
  ctx.strokeStyle = `rgba(${color},0.28)`;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(x - size * 6, y);
  ctx.lineTo(x + size * 6, y);
  ctx.moveTo(x, y - size * 6);
  ctx.lineTo(x, y + size * 6);
  ctx.stroke();
}

export function paintSky(width: number, height: number, dpr: number) {
  const { node, ctx } = layer(width * dpr, height * dpr);
  ctx.scale(dpr, dpr);
  ctx.fillStyle = "#030508";
  ctx.fillRect(0, 0, width, height);
  const rand = random(117);
  const count = Math.min(900, (width * height) / 1300);
  for (let i = 0; i < count; i++) {
    const x = rand() * width,
      y = rand() * height;
    const size = 0.25 + rand() ** 4 * 0.8;
    const color =
      i % 7 === 0 ? "235,167,141" : i % 5 === 0 ? "146,184,255" : "202,215,231";
    ctx.fillStyle = `rgba(${color},${0.12 + rand() * 0.5})`;
    ctx.fillRect(x, y, size, size);
    if (i % 83 === 0) star(ctx, x, y, 0.65, color);
  }
  return node;
}

/** A face-on galaxy: branching logarithmic arms, star-forming knots and dark dust gaps.
 * The sprite is projected into an inclined disk by the scene, so every particle shares a plane. */
export function paintGalaxy(seed: number, cooler = false) {
  const { node, ctx } = layer(1024);
  const rand = random(seed),
    radius = 440;
  const blue = glowSprite("109,178,255");
  const gold = glowSprite("255,204,147");
  const pearl = glowSprite("210,229,255");
  ctx.translate(512, 512);
  const spiral = (r: number, arm: number) =>
    (arm * Math.PI * 2) / 3 +
    Math.log(0.075 + r) * 5.3 +
    0.28 * Math.sin(r * 10 + arm);
  // A diffuse stellar halo, sufficiently faint that the space between the arms remains black.
  const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
  halo.addColorStop(0, "rgba(183,140,116,0.2)");
  halo.addColorStop(0.2, "rgba(103,112,153,0.09)");
  halo.addColorStop(0.65, "rgba(67,110,162,0.035)");
  halo.addColorStop(1, "rgba(30,70,120,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(-512, -512, 1024, 1024);

  // Filamentary clouds: clustered along the arms, with small irregular branches.
  for (let i = 0; i < 4400; i++) {
    const r = 0.06 + rand() ** 0.78 * 0.93,
      arm = i % 3;
    const angle = spiral(r, arm) + gaussian(rand) * (0.18 + r * 0.16);
    const stretch = 1 + 0.07 * Math.sin(angle * 3 + r * 12);
    const x = Math.cos(angle) * r * radius * stretch;
    const y = Math.sin(angle) * r * radius;
    const size = 7 + rand() * 32;
    ctx.globalAlpha = 0.13 + rand() * 0.27;
    ctx.drawImage(
      rand() < r * 0.8 + 0.15 ? blue : gold,
      x - size,
      y - size,
      size * 2,
      size * 2,
    );
  }
  ctx.globalAlpha = 1;
  // Individual stars retain a granular, photographic texture even in the expanded view.
  for (let i = 0; i < 85000; i++) {
    const r = 0.025 + rand() ** 0.78 * 0.94,
      arm = i % 3;
    const lane = ((i % 5) - 2) * 0.043;
    const branching = Math.sin(r * 62 + arm * 4) * 0.035;
    const angle =
      spiral(r, arm) +
      lane +
      branching +
      gaussian(rand) * (i % 4 === 0 ? 0.6 : 0.09 + r * 0.18);
    const dr = r + gaussian(rand) * 0.013;
    const x =
      Math.cos(angle) * dr * radius * (1 + 0.07 * Math.sin(angle * 3 + r * 12));
    const y = Math.sin(angle) * dr * radius;
    const warm = rand() < (cooler ? 0.6 : 0.83) - r * 0.48;
    const color = warm
      ? "249,217,181"
      : i % 3 !== 0
        ? "196,223,249"
        : "104,171,241";
    const clump = 0.5 + 0.5 * Math.sin(r * 87 + arm * 12) ** 2;
    ctx.fillStyle = `rgba(${color},${(0.16 + rand() ** 2 * 0.7) * clump})`;
    const size = 0.4 + rand() ** 4 * 1.35;
    ctx.fillRect(x, y, size, size);
  }
  // Dark lanes divide the arms into wisps rather than a smooth neon spiral.
  ctx.globalCompositeOperation = "destination-out";
  for (let arm = 0; arm < 3; arm++) {
    for (let lane = 0; lane < 5; lane++) {
      ctx.strokeStyle = `rgba(0,0,0,${0.13 + lane * 0.03})`;
      ctx.lineWidth = 1.5 + lane;
      ctx.beginPath();
      for (let i = 0; i < 300; i++) {
        const r = 0.08 + (i / 300) * 0.9;
        const a =
          spiral(r, arm) - 0.035 - lane * 0.055 + Math.sin(r * 46) * 0.025;
        const x = Math.cos(a) * r * radius,
          y = Math.sin(a) * r * radius;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
  }
  ctx.globalCompositeOperation = "source-over";
  // Sparse knots add scale, with a few diffraction stars instead of uniform glitter.
  for (let i = 0; i < 620; i++) {
    const r = 0.17 + rand() * 0.77,
      angle = spiral(r, i % 3) + gaussian(rand) * 0.16;
    const x = Math.cos(angle) * r * radius,
      y = Math.sin(angle) * r * radius;
    const size = 2 + rand() ** 3 * 13;
    ctx.globalAlpha = 0.3 + rand() * 0.7;
    ctx.drawImage(
      i % 4 === 0 ? gold : pearl,
      x - size,
      y - size,
      size * 2,
      size * 2,
    );
    if (i % 61 === 0) star(ctx, x, y, 1.15, "186,216,255");
  }
  ctx.globalAlpha = 1;
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, radius * 0.21);
  core.addColorStop(0, "rgba(255,249,225,0.98)");
  core.addColorStop(0.06, "rgba(255,233,181,0.94)");
  core.addColorStop(0.19, "rgba(247,194,126,0.68)");
  core.addColorStop(0.48, "rgba(173,122,92,0.22)");
  core.addColorStop(1, "rgba(104,84,118,0)");
  ctx.fillStyle = core;
  ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
  return node;
}

/** A diffuse tidal bridge in normalized coordinates; rescaled between the two live cores. */
export function paintTidalBridge() {
  const { node, ctx } = layer(1024, 256),
    rand = random(541);
  const blue = glowSprite("119,181,236");
  for (let i = 0; i < 18000; i++) {
    const u = rand(),
      strand = (i % 3) - 1;
    const curve =
      Math.sin(u * Math.PI * 2) * 27 + strand * Math.sin(u * Math.PI) * 19;
    const x = u * 1024;
    const y = 128 + curve + gaussian(rand) * (6 + 18 * Math.sin(u * Math.PI));
    const fade = Math.sin(u * Math.PI) ** 0.5;
    ctx.fillStyle = `rgba(${i % 6 === 0 ? "231,200,170" : "132,191,244"},${(0.04 + rand() * 0.22) * fade})`;
    const size = 0.3 + rand() * 0.7;
    ctx.fillRect(x, y, size, size);
    if (i % 41 === 0) {
      ctx.globalAlpha = fade * 0.17;
      ctx.drawImage(blue, x - 12, y - 12, 24, 24);
      ctx.globalAlpha = 1;
    }
  }
  return node;
}

export function drawGalaxy(
  ctx: CanvasRenderingContext2D,
  artwork: HTMLCanvasElement,
  x: number,
  y: number,
  radius: number,
  inclination: number,
  rotation: number,
  spin: number,
  energy: number,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.scale(1, inclination);
  ctx.rotate(spin);
  ctx.globalAlpha = 0.88 + energy * 0.12;
  ctx.drawImage(artwork, -radius, -radius, radius * 2, radius * 2);
  ctx.restore();
  // The luminous nucleus swells gently with the measured level of its own voice.
  const reach = radius * (0.13 + energy * 0.07);
  const core = ctx.createRadialGradient(x, y, 0, x, y, reach);
  core.addColorStop(0, `rgba(255,242,208,${0.38 + energy * 0.26})`);
  core.addColorStop(0.2, `rgba(248,204,143,${0.16 + energy * 0.12})`);
  core.addColorStop(1, "rgba(226,173,125,0)");
  ctx.fillStyle = core;
  ctx.fillRect(x - reach, y - reach, reach * 2, reach * 2);
}
