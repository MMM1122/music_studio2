/**
 * WebGL2 renderer for the binary galaxies. Stars are additive Gaussian sprites in a
 * half-float buffer, dust lanes then absorb that light (blue first, so they read brown), and
 * a tone-mapped composite with a soft bloom gives the luminous, photographic look. All star
 * positions come from the CPU simulation each frame; nothing here knows about music.
 */
import { random } from "./orbitArtwork";
import type { Galaxies, Vec3 } from "./binary";
import { MAX_RIPPLES, RIPPLE_SPEED, type Light, type Ripple } from "./melody";

/** What the melody is doing this frame (see MelodyTracker). */
export interface MelodyLight {
  ripples: Ripple[];
  lights: Light[];
  bridge: number;
}
export const NO_MELODY: MelodyLight = { ripples: [], lights: [], bridge: 0 };
const MAX_LIGHTS = 4;

export interface GalaxyView {
  /** CSS pixels. */
  width: number;
  height: number;
  dpr: number;
  /** Screen position of the centre of mass and pixels per galaxy radius. */
  centerX: number;
  centerY: number;
  scale: number;
  /** Row-major world→view rotation; view x right, y up. */
  rotation: number[];
}

export interface FrameLight {
  /** 0–1 brightness of each galaxy's own voice and of the whole mix. */
  glowA: number;
  glowB: number;
  energy: number;
}

export interface GalaxyRenderer {
  /** Draws stars at `world` (3 floats each, as in Galaxies.world) and the two cores. */
  draw(
    view: GalaxyView,
    world: Float32Array,
    coreA: Vec3,
    coreB: Vec3,
    light: FrameLight,
    melody?: MelodyLight,
  ): void;
  dispose(): void;
}

const POINTS_VS = `#version 300 es
in vec3 aPos;
in vec4 aColor;
in float aSize;
in float aKind;
in float aHost;
/** Calm radius within its own galaxy, in that galaxy's radii (0 for the cores). */
in float aHome;
uniform mat3 uView;
uniform vec2 uCenter;
uniform float uScale;
uniform vec2 uResolution;
uniform float uDpr;
uniform vec2 uGlow;
uniform float uEnergy;
uniform float uDust;
// Melody: ripples (host, age, strength, hue), held-note lights (host, radius, strength, hue),
// and the bridge flash between the two cores (world space).
uniform vec4 uRipples[${MAX_RIPPLES}];
uniform vec4 uLights[${MAX_LIGHTS}];
uniform float uBridge;
uniform vec3 uCoreA;
uniform vec3 uCoreB;
out vec3 vColor;
flat out float vKind;
void main() {
  bool dust = aKind > 2.5;
  if (dust != (uDust > 0.5)) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  vec3 p = uView * aPos;
  vec2 px = uCenter + vec2(p.x, -p.y) * uScale;
  gl_Position = vec4(px / uResolution * 2.0 - 1.0, 0.0, 1.0);
  gl_Position.y = -gl_Position.y;
  float size = aSize * uScale * uDpr;
  float drawn = clamp(size, 1.5, 96.0);
  gl_PointSize = drawn;
  // Sprites clamped to a minimum size keep the light they would have had.
  float keep = min(1.0, (size * size) / (drawn * drawn));
  float glow = aHost < 0.5 ? uGlow.x : uGlow.y;
  float lift = aKind < 0.5 ? 0.12 : aKind < 1.5 ? 0.9 : 0.35;
  float intensity = aColor.a * keep * (1.0 + glow * lift + uEnergy * 0.25);
  if (dust) {
    vColor = aColor.rgb * aColor.a;
  } else {
    float boost = 0.0, hue = 0.0;
    for (int k = 0; k < ${MAX_RIPPLES}; k++) {
      vec4 r = uRipples[k];
      if (r.z <= 0.0 || abs(r.x - aHost) > 0.5) continue;
      float d = (aHome - r.y * ${RIPPLE_SPEED.toFixed(3)}) / 0.15;
      float b = r.z * 1.3 * exp(-d * d) * exp(-r.y * 1.2);
      boost += b;
      hue += r.w * b;
    }
    for (int k = 0; k < ${MAX_LIGHTS}; k++) {
      vec4 l = uLights[k];
      if (l.z <= 0.0 || abs(l.x - aHost) > 0.5) continue;
      float d = (aHome - l.y) / 0.11;
      float b = l.z * 1.2 * exp(-d * d);
      boost += b;
      hue += l.w * b;
    }
    if (uBridge > 0.0) {
      vec3 ab = uCoreB - uCoreA;
      float t = clamp(dot(aPos - uCoreA, ab) / dot(ab, ab), 0.0, 1.0);
      vec3 off = aPos - (uCoreA + ab * t);
      float b = uBridge * exp(-dot(off, off) / 0.12) *
        smoothstep(0.05, 0.3, t) * smoothstep(0.95, 0.7, t) * 2.0;
      boost += b;
      hue += 0.5 * b;
    }
    // Several waves can overlap; cap their sum so the arms never wash out to white.
    float raw = boost;
    boost = 1.6 * (1.0 - exp(-raw / 1.6));
    hue *= raw > 0.0 ? boost / raw : 0.0;
    // Low notes warm the light toward gold, high notes cool it toward ice blue.
    vec3 tint = mix(vec3(1.0, 0.6, 0.24), vec3(0.4, 0.7, 1.0), boost > 0.0 ? hue / boost : 0.5);
    vec3 base = aColor.rgb;
    vec3 lit = mix(base, tint * max(max(base.r, base.g), base.b), min(1.0, boost * 0.6));
    // Brighten what is there, and add a little light of the note's colour of its own, so
    // even the faint disk between the arms catches the wave.
    vColor = lit * intensity * (1.0 + boost * 2.4) + tint * boost * 0.1 * keep;
  }
  vKind = aKind;
}`;

const POINTS_FS = `#version 300 es
precision mediump float;
in vec3 vColor;
flat in float vKind;
out vec4 outColor;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  float a;
  if (vKind < 0.5) a = exp(-r2 * 6.0);
  else if (vKind < 1.5) a = exp(-r2 * 9.0) + 0.22 * exp(-r2 * 2.2);
  else if (vKind < 2.5) a = exp(-r2 * 3.0) * (1.0 - r2);
  else a = exp(-r2 * 2.5) * (1.0 - r2);
  outColor = vec4(vColor * a, a);
}`;

const SKY_VS = `#version 300 es
in vec2 aUV;
in vec4 aColor;
in float aSize;
uniform vec2 uResolution;
uniform float uDpr;
out vec4 vColor;
out float vSpike;
void main() {
  gl_Position = vec4(aUV * 2.0 - 1.0, 0.0, 1.0);
  float size = aSize * uDpr;
  gl_PointSize = size;
  vColor = aColor;
  vSpike = size > 12.0 ? 1.0 : 0.0;
}`;

const SKY_FS = `#version 300 es
precision mediump float;
in vec4 vColor;
in float vSpike;
out vec4 outColor;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  float a = exp(-r2 * (vSpike > 0.5 ? 140.0 : 7.0));
  if (vSpike > 0.5) {
    // Four diffraction spikes and a faint halo, as on a reflecting telescope.
    vec2 q = abs(c);
    a += exp(-q.x * 60.0) * exp(-q.y * 4.0) + exp(-q.y * 60.0) * exp(-q.x * 4.0);
    a += 0.18 * exp(-r2 * 18.0);
  }
  outColor = vec4(vColor.rgb * vColor.a * a, a);
}`;

const QUAD_VS = `#version 300 es
out vec2 vUV;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUV = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const BRIGHT_FS = `#version 300 es
precision mediump float;
in vec2 vUV;
uniform sampler2D uImage;
uniform vec2 uTexel;
out vec4 outColor;
void main() {
  // 4-tap box downsample, keeping only light above the threshold for the bloom.
  vec3 c = texture(uImage, vUV + uTexel * vec2(-1.0, -1.0)).rgb
         + texture(uImage, vUV + uTexel * vec2(1.0, -1.0)).rgb
         + texture(uImage, vUV + uTexel * vec2(-1.0, 1.0)).rgb
         + texture(uImage, vUV + uTexel * vec2(1.0, 1.0)).rgb;
  c *= 0.25;
  outColor = vec4(max(c - vec3(0.35), vec3(0.0)), 1.0);
}`;

const BLUR_FS = `#version 300 es
precision mediump float;
in vec2 vUV;
uniform sampler2D uImage;
uniform vec2 uStep;
out vec4 outColor;
void main() {
  vec3 c = texture(uImage, vUV).rgb * 0.227;
  c += texture(uImage, vUV + uStep * 1.385).rgb * 0.316;
  c += texture(uImage, vUV - uStep * 1.385).rgb * 0.316;
  c += texture(uImage, vUV + uStep * 3.231).rgb * 0.070;
  c += texture(uImage, vUV - uStep * 3.231).rgb * 0.070;
  outColor = vec4(c, 1.0);
}`;

const COMPOSITE_FS = `#version 300 es
precision mediump float;
in vec2 vUV;
uniform sampler2D uImage;
uniform sampler2D uBloom;
uniform float uExposure;
out vec4 outColor;
void main() {
  vec3 hdr = texture(uImage, vUV).rgb + texture(uBloom, vUV).rgb * 0.55;
  vec3 c = vec3(1.0) - exp(-hdr * uExposure);
  // A touch of saturation and a deep blue-black floor, like a long exposure.
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, 1.12);
  c = c + vec3(0.010, 0.014, 0.022) * (1.0 - l);
  vec2 d = vUV - 0.5;
  c *= 1.0 - dot(d, d) * 0.35;
  outColor = vec4(pow(max(c, vec3(0.0)), vec3(0.92)), 1.0);
}`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const program = gl.createProgram()!;
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vs],
    [gl.FRAGMENT_SHADER, fs],
  ] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(shader) ?? "shader");
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(program) ?? "link");
  return program;
}

interface Target {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  width: number;
  height: number;
}

/** Background sky: faint stars and distant galaxies, plus a few bright stars with spikes. */
function skyData() {
  const rand = random(311);
  const n = 1400;
  const uv = new Float32Array(n * 2),
    color = new Float32Array(n * 4),
    size = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    uv[i * 2] = rand();
    uv[i * 2 + 1] = rand();
    const kind = rand();
    const rgb =
      kind < 0.12
        ? [1, 0.45, 0.3]
        : kind < 0.2
          ? [1, 0.75, 0.45]
          : kind < 0.45
            ? [0.7, 0.8, 1]
            : [0.92, 0.94, 1];
    const bright = rand() ** 6;
    color.set([rgb[0], rgb[1], rgb[2], 0.08 + bright * 0.9], i * 4);
    size[i] = 1.5 + bright * 3;
  }
  // Foreground stars with diffraction spikes.
  for (const i of [3, 71, 402, 977, 1210]) {
    size[i] = 26 + rand() * 18;
    color.set([0.85, 0.9, 1, 1.4], i * 4);
  }
  color.set([1, 0.6, 0.42, 1.6], 71 * 4);
  return { uv, color, size, count: n };
}

/** Whether this browser can run the renderer: WebGL2 with float render targets. Checked on a
 * scratch canvas, so a failure leaves the real canvas free for the 2D fallback. */
export function supportsGalaxyGL() {
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    const ok = !!gl?.getExtension("EXT_color_buffer_float");
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return ok;
  } catch {
    return false;
  }
}

/** Creates the renderer, or returns null when WebGL2 with float render targets is missing. */
export function createGalaxyRenderer(
  canvas: HTMLCanvasElement,
  stars: Galaxies,
  /** Radius of each galaxy, to place every star on its own disk for melody light. */
  radii: [number, number] = [1, 1],
): GalaxyRenderer | null {
  const gl = canvas.getContext("webgl2", {
    antialias: false,
    alpha: false,
    premultipliedAlpha: false,
    // Keep the last frame, so a still (reduced motion, paused tab) stays exactly as drawn.
    preserveDrawingBuffer: true,
    powerPreference: "low-power",
  });
  if (!gl || !gl.getExtension("EXT_color_buffer_float")) return null;
  let points: WebGLProgram,
    sky: WebGLProgram,
    bright: WebGLProgram,
    blur: WebGLProgram,
    composite: WebGLProgram;
  try {
    points = compile(gl, POINTS_VS, POINTS_FS);
    sky = compile(gl, SKY_VS, SKY_FS);
    bright = compile(gl, QUAD_VS, BRIGHT_FS);
    blur = compile(gl, QUAD_VS, BLUR_FS);
    composite = compile(gl, QUAD_VS, COMPOSITE_FS);
  } catch {
    return null;
  }
  const uniforms = (program: WebGLProgram, names: string[]) =>
    Object.fromEntries(
      names.map((name) => [name, gl.getUniformLocation(program, name)]),
    );
  const pu = uniforms(points, [
    "uRipples",
    "uLights",
    "uBridge",
    "uCoreA",
    "uCoreB",
    "uView",
    "uCenter",
    "uScale",
    "uResolution",
    "uDpr",
    "uGlow",
    "uEnergy",
    "uDust",
  ]);
  const su = uniforms(sky, ["uResolution", "uDpr"]);
  const bu = uniforms(bright, ["uImage", "uTexel"]);
  const lu = uniforms(blur, ["uImage", "uStep"]);
  const cu = uniforms(composite, ["uImage", "uBloom", "uExposure"]);

  // Star attributes: positions change every frame, everything else is fixed. Two extra
  // points at the end are the luminous cores.
  const total = stars.count + 2;
  const positions = new Float32Array(total * 3);
  const colors = new Float32Array(total * 4),
    sizes = new Float32Array(total),
    kinds = new Float32Array(total),
    hosts = new Float32Array(total),
    homes = new Float32Array(total);
  colors.set(stars.color);
  sizes.set(stars.size);
  for (let i = 0; i < stars.count; i++) {
    kinds[i] = stars.kind[i];
    hosts[i] = stars.host[i];
    homes[i] = stars.home[i * 3] / radii[stars.host[i]];
  }
  for (const [k, host, radius] of [
    [stars.count, 0, 0.16],
    [stars.count + 1, 1, 0.12],
  ]) {
    colors.set([1, 0.82, 0.58, 0.55], k * 4);
    sizes[k] = radius;
    kinds[k] = 1;
    hosts[k] = host;
  }
  const pointsVao = gl.createVertexArray()!;
  gl.bindVertexArray(pointsVao);
  const buffer = (
    data: Float32Array,
    name: string,
    width: number,
    program: WebGLProgram,
    usage: number = gl.STATIC_DRAW,
  ) => {
    const b = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, usage);
    const location = gl.getAttribLocation(program, name);
    if (location >= 0) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, width, gl.FLOAT, false, 0, 0);
    }
    return b;
  };
  const positionBuffer = buffer(positions, "aPos", 3, points, gl.DYNAMIC_DRAW);
  const buffers = [
    positionBuffer,
    buffer(colors, "aColor", 4, points),
    buffer(sizes, "aSize", 1, points),
    buffer(kinds, "aKind", 1, points),
    buffer(hosts, "aHost", 1, points),
    buffer(homes, "aHome", 1, points),
  ];
  const skyStars = skyData();
  const skyVao = gl.createVertexArray()!;
  gl.bindVertexArray(skyVao);
  buffers.push(
    buffer(skyStars.uv, "aUV", 2, sky),
    buffer(skyStars.color, "aColor", 4, sky),
    buffer(skyStars.size, "aSize", 1, sky),
  );
  const quadVao = gl.createVertexArray()!;
  gl.bindVertexArray(null);

  const targets: Target[] = [];
  const makeTarget = (width: number, height: number): Target => {
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA16F,
      width,
      height,
      0,
      gl.RGBA,
      gl.HALF_FLOAT,
      null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const framebuffer = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      texture,
      0,
    );
    return { texture, framebuffer, width, height };
  };
  let hdr: Target | null = null,
    bloomA: Target | null = null,
    bloomB: Target | null = null;
  const release = () => {
    for (const t of targets) {
      gl.deleteTexture(t.texture);
      gl.deleteFramebuffer(t.framebuffer);
    }
    targets.length = 0;
  };
  const ensureTargets = (width: number, height: number) => {
    if (hdr && hdr.width === width && hdr.height === height) return;
    release();
    hdr = makeTarget(width, height);
    const w = Math.max(1, width >> 2),
      h = Math.max(1, height >> 2);
    bloomA = makeTarget(w, h);
    bloomB = makeTarget(w, h);
    targets.push(hdr, bloomA, bloomB);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
      throw new Error("Float render targets are not supported.");
  };
  const pass = (target: Target | null, program: WebGLProgram) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target?.framebuffer ?? null);
    gl.viewport(
      0,
      0,
      target?.width ?? canvas.width,
      target?.height ?? canvas.height,
    );
    gl.useProgram(program);
  };

  return {
    draw(view, world, coreA, coreB, light, melody = NO_MELODY) {
      const width = canvas.width,
        height = canvas.height;
      ensureTargets(width, height);
      positions.set(world);
      positions.set(coreA, stars.count * 3);
      positions.set(coreB, stars.count * 3 + 3);
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions);

      // Light: sky, then stars, both additive into the float buffer.
      pass(hdr, sky);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.uniform2f(su.uResolution, view.width, view.height);
      gl.uniform1f(su.uDpr, view.dpr);
      gl.bindVertexArray(skyVao);
      gl.drawArrays(gl.POINTS, 0, skyStars.count);

      gl.useProgram(points);
      gl.uniformMatrix3fv(pu.uView, true, view.rotation);
      gl.uniform2f(pu.uCenter, view.centerX, view.centerY);
      gl.uniform1f(pu.uScale, view.scale);
      gl.uniform2f(pu.uResolution, view.width, view.height);
      gl.uniform1f(pu.uDpr, view.dpr);
      gl.uniform2f(pu.uGlow, light.glowA, light.glowB);
      gl.uniform1f(pu.uEnergy, light.energy);
      const ripples = new Float32Array(MAX_RIPPLES * 4);
      melody.ripples
        .slice(-MAX_RIPPLES)
        .forEach((r, k) =>
          ripples.set([r.host, r.age, r.strength, r.hue], k * 4),
        );
      const lights = new Float32Array(MAX_LIGHTS * 4);
      melody.lights
        .slice(0, MAX_LIGHTS)
        .forEach((l, k) =>
          lights.set([l.host, l.radius, l.strength, l.hue], k * 4),
        );
      gl.uniform4fv(pu.uRipples, ripples);
      gl.uniform4fv(pu.uLights, lights);
      gl.uniform1f(pu.uBridge, melody.bridge);
      gl.uniform3fv(pu.uCoreA, coreA);
      gl.uniform3fv(pu.uCoreB, coreB);
      gl.uniform1f(pu.uDust, 0);
      gl.bindVertexArray(pointsVao);
      gl.drawArrays(gl.POINTS, 0, total);
      // Dust: multiply what is behind by (1 − absorption).
      gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_COLOR);
      gl.uniform1f(pu.uDust, 1);
      gl.drawArrays(gl.POINTS, 0, total);
      gl.disable(gl.BLEND);

      // Bloom: bright pass at quarter size, then a separable blur.
      gl.bindVertexArray(quadVao);
      pass(bloomA, bright);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, hdr!.texture);
      gl.uniform1i(bu.uImage, 0);
      gl.uniform2f(bu.uTexel, 1 / width, 1 / height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      for (const [from, to, x, y] of [
        [bloomA, bloomB, 1, 0],
        [bloomB, bloomA, 0, 1],
        [bloomA, bloomB, 2, 0],
        [bloomB, bloomA, 0, 2],
      ] as const) {
        pass(to, blur);
        gl.bindTexture(gl.TEXTURE_2D, from!.texture);
        gl.uniform1i(lu.uImage, 0);
        gl.uniform2f(lu.uStep, x / from!.width, y / from!.height);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }

      pass(null, composite);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, hdr!.texture);
      gl.uniform1i(cu.uImage, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, bloomA!.texture);
      gl.uniform1i(cu.uBloom, 1);
      gl.uniform1f(cu.uExposure, 1.35 + light.energy * 0.25);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindVertexArray(null);
    },
    dispose() {
      release();
      for (const b of buffers) gl.deleteBuffer(b);
      for (const p of [points, sky, bright, blur, composite])
        gl.deleteProgram(p);
      gl.deleteVertexArray(pointsVao);
      gl.deleteVertexArray(skyVao);
      gl.deleteVertexArray(quadVao);
    },
  };
}

/** World→view rotation: the orbit plane seen nearly edge-on, then rolled slightly so the
 * pair sits on a gentle diagonal. */
export function viewRotation(tilt = 0.36, roll = -0.16): number[] {
  const ct = Math.cos(tilt),
    st = Math.sin(tilt),
    cr = Math.cos(roll),
    sr = Math.sin(roll);
  // Rows of Rx(tilt): x' = x; y' = y·cos + z·sin; z' = −y·sin + z·cos. Then roll in the view.
  const rx = [
    [1, 0, 0],
    [0, ct, st],
    [0, -st, ct],
  ];
  const rz = [
    [cr, -sr, 0],
    [sr, cr, 0],
    [0, 0, 1],
  ];
  const m: number[] = [];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      m.push(rz[r][0] * rx[0][c] + rz[r][1] * rx[1][c] + rz[r][2] * rx[2][c]);
  return m;
}

/** Camera for a frame of this size: in a wide strip the orbit is seen closer to edge-on, so
 * the pair moves side to side, and the larger disk fits the height; a tall frame shows the
 * orbit more open and leans in further as the pair closes. */
export function frameView(
  width: number,
  height: number,
  dpr: number,
  zoom: number,
): GalaxyView {
  const strip = width / height > 3;
  const lean = strip ? 1 + (zoom - 1) * 0.45 : zoom;
  return {
    width,
    height,
    dpr,
    centerX: width * 0.5,
    centerY: height * (strip ? 0.5 : 0.52),
    scale: Math.min(width / 5.4, height / (strip ? 1.85 : 1.45)) * lean,
    rotation: strip ? viewRotation(0.2, -0.05) : viewRotation(),
  };
}
