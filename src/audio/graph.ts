import type { Track, Instrument } from "../domain/models";

export interface Voice {
  stop(time?: number): void;
}
const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));
const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();
const impulses = new WeakMap<BaseAudioContext, AudioBuffer>();
const clipCurves = new WeakMap<BaseAudioContext, Float32Array<ArrayBuffer>>();

/** Small deterministic generator: renders are reproducible, so tests can compare them. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state / 0xffffffff) * 2 - 1;
  };
}
function noise(context: BaseAudioContext): AudioBuffer {
  const existing = noiseBuffers.get(context);
  if (existing) return existing;
  const buffer = context.createBuffer(
    1,
    context.sampleRate * 2,
    context.sampleRate,
  );
  const data = buffer.getChannelData(0);
  const next = lcg(7319);
  for (let index = 0; index < data.length; index++) data[index] = next();
  noiseBuffers.set(context, buffer);
  return buffer;
}
/** A warm medium room: a few early reflections, then a tail whose highs fade before its lows. */
function impulse(context: BaseAudioContext): AudioBuffer {
  const existing = impulses.get(context);
  if (existing) return existing;
  const rate = context.sampleRate;
  const length = Math.floor(rate * 2.4);
  const buffer = context.createBuffer(2, length, rate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    const next = lcg(137 + channel * 7919);
    let low = 0;
    for (let index = 0; index < length; index++) {
      const t = index / rate;
      // One-pole low-pass that closes as the tail decays, so the room darkens naturally.
      const openness = 0.12 + 0.6 * Math.exp(-t * 2.6);
      low += openness * (next() - low);
      data[index] = low * Math.exp(-t * 3.1) * Math.min(1, t * 90);
    }
    // Early reflections differ per side, which is what makes the room feel wide.
    const taps =
      channel === 0
        ? [0.011, 0.023, 0.037, 0.052]
        : [0.014, 0.027, 0.041, 0.058];
    taps.forEach((seconds, order) => {
      const at = Math.floor(seconds * rate);
      if (at < length) data[at] += (order % 2 ? -1 : 1) * 0.5 * 0.72 ** order;
    });
  }
  impulses.set(context, buffer);
  return buffer;
}
/** Gentle saturation curve used as a safety clipper: transparent below about -6 dBFS. */
function softClip(context: BaseAudioContext): Float32Array<ArrayBuffer> {
  const existing = clipCurves.get(context);
  if (existing) return existing;
  const curve = new Float32Array(2049);
  const drive = 1.4;
  for (let index = 0; index < curve.length; index++) {
    const x = (index / (curve.length - 1)) * 2 - 1;
    curve[index] = Math.tanh(x * drive) / Math.tanh(drive);
  }
  clipCurves.set(context, curve);
  return curve;
}

/** The shared end of the signal path: one reverb room and one tempo-synced delay that every
 * track sends to, then bus compression and a limiter. Sharing the room is what makes separate
 * instruments sound like they were recorded in the same place, and it costs one convolver
 * instead of one per track. The same class runs realtime playback and offline export. */
export class MixBus {
  readonly input: GainNode;
  readonly reverbSend: GainNode;
  readonly delaySend: GainNode;
  private readonly master: GainNode;
  private readonly delayLeft: DelayNode;
  private readonly delayRight: DelayNode;
  private readonly nodes: AudioNode[];
  constructor(
    private readonly context: BaseAudioContext,
    destination: AudioNode,
    masterVolume: number,
    bpm: number,
  ) {
    const c = context;
    this.input = c.createGain();
    this.master = c.createGain();
    // Glue: slow, low-ratio compression that lets transients through and evens out the body.
    const glue = c.createDynamicsCompressor();
    glue.threshold.value = -16;
    glue.knee.value = 12;
    glue.ratio.value = 2.2;
    glue.attack.value = 0.025;
    glue.release.value = 0.22;
    const makeup = c.createGain();
    makeup.gain.value = 1.25;
    // Removes DC and sub-audible rumble, which eat headroom without being heard.
    const rumble = c.createBiquadFilter();
    rumble.type = "highpass";
    rumble.frequency.value = 26;
    rumble.Q.value = 0.7;
    const clipper = c.createWaveShaper();
    clipper.curve = softClip(c);
    clipper.oversample = "2x";
    const limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.09;
    this.input.connect(rumble);
    rumble.connect(this.master);
    this.master.connect(glue);
    glue.connect(makeup);
    makeup.connect(clipper);
    clipper.connect(limiter);
    limiter.connect(destination);

    // Reverb: pre-delay keeps the dry attack clear; the high-pass keeps bass out of the room.
    this.reverbSend = c.createGain();
    const preDelay = c.createDelay(0.1);
    preDelay.delayTime.value = 0.018;
    const reverbHighPass = c.createBiquadFilter();
    reverbHighPass.type = "highpass";
    reverbHighPass.frequency.value = 190;
    const reverb = c.createConvolver();
    reverb.buffer = impulse(c);
    const reverbTone = c.createBiquadFilter();
    reverbTone.type = "lowpass";
    reverbTone.frequency.value = 7200;
    const reverbReturn = c.createGain();
    reverbReturn.gain.value = 0.9;
    this.reverbSend.connect(preDelay);
    preDelay.connect(reverbHighPass);
    reverbHighPass.connect(reverb);
    reverb.connect(reverbTone);
    reverbTone.connect(reverbReturn);
    reverbReturn.connect(this.input);

    // Delay: dotted-eighth ping-pong. Each repeat is filtered so echoes sit behind the source.
    this.delaySend = c.createGain();
    const delayHighPass = c.createBiquadFilter();
    delayHighPass.type = "highpass";
    delayHighPass.frequency.value = 260;
    this.delayLeft = c.createDelay(2);
    this.delayRight = c.createDelay(2);
    const feedback = c.createGain();
    feedback.gain.value = 0.34;
    const damp = c.createBiquadFilter();
    damp.type = "lowpass";
    damp.frequency.value = 3400;
    const panLeft = c.createStereoPanner();
    panLeft.pan.value = -0.7;
    const panRight = c.createStereoPanner();
    panRight.pan.value = 0.7;
    const delayReturn = c.createGain();
    delayReturn.gain.value = 0.8;
    this.delaySend.connect(delayHighPass);
    delayHighPass.connect(this.delayLeft);
    this.delayLeft.connect(panLeft);
    this.delayLeft.connect(this.delayRight);
    this.delayRight.connect(panRight);
    this.delayRight.connect(damp);
    damp.connect(feedback);
    feedback.connect(this.delayLeft);
    panLeft.connect(delayReturn);
    panRight.connect(delayReturn);
    delayReturn.connect(this.input);

    this.nodes = [
      this.input,
      rumble,
      this.master,
      glue,
      makeup,
      clipper,
      limiter,
      this.reverbSend,
      preDelay,
      reverbHighPass,
      reverb,
      reverbTone,
      reverbReturn,
      this.delaySend,
      delayHighPass,
      this.delayLeft,
      this.delayRight,
      feedback,
      damp,
      panLeft,
      panRight,
      delayReturn,
    ];
    this.update(masterVolume, bpm, true);
  }
  update(masterVolume: number, bpm: number, immediate = false) {
    const time = this.context.currentTime;
    const set = (parameter: AudioParam, value: number, glide = 0.012) => {
      if (immediate) parameter.setValueAtTime(value, time);
      else parameter.setTargetAtTime(value, time, glide);
    };
    set(this.master.gain, clamp(masterVolume, 0, 1.5));
    const dottedEighth = clamp((60 / Math.max(1, bpm)) * 0.75, 0.02, 1.9);
    // Each side delays by one dotted eighth, so the echo alternates left, right, left…
    set(this.delayLeft.delayTime, dottedEighth, 0.05);
    set(this.delayRight.delayTime, dottedEighth, 0.05);
  }
  dispose() {
    this.nodes.forEach((node) => node.disconnect());
  }
}

/** Per-track strip: tone filter, pan, fader, and post-fader sends to the shared room and delay.
 * Allocated once per track; parameters are smoothed in place. */
export class TrackGraph {
  readonly input: GainNode;
  private readonly filter: BiquadFilterNode;
  private readonly pan: StereoPannerNode;
  private readonly output: GainNode;
  private readonly reverbSend: GainNode;
  private readonly delaySend: GainNode;
  private readonly nodes: AudioNode[];
  constructor(
    private readonly context: BaseAudioContext,
    bus: MixBus,
    track: Track,
    audible: boolean,
  ) {
    this.input = context.createGain();
    this.filter = context.createBiquadFilter();
    this.pan = context.createStereoPanner();
    this.output = context.createGain();
    this.reverbSend = context.createGain();
    this.delaySend = context.createGain();
    this.filter.type = "lowpass";
    this.filter.Q.value = 0.5;
    this.input.connect(this.filter);
    this.filter.connect(this.pan);
    this.pan.connect(this.output);
    this.output.connect(bus.input);
    this.output.connect(this.reverbSend);
    this.reverbSend.connect(bus.reverbSend);
    this.output.connect(this.delaySend);
    this.delaySend.connect(bus.delaySend);
    this.nodes = [
      this.input,
      this.filter,
      this.pan,
      this.output,
      this.reverbSend,
      this.delaySend,
    ];
    this.update(track, audible, true);
  }
  update(track: Track, audible: boolean, immediate = false) {
    const time = this.context.currentTime;
    const set = (parameter: AudioParam, value: number) => {
      if (immediate) parameter.setValueAtTime(value, time);
      else parameter.setTargetAtTime(value, time, 0.012);
    };
    set(this.output.gain, audible ? clamp(track.mixer.volume, 0, 1.5) : 0);
    set(this.pan.pan, clamp(track.mixer.pan, -1, 1));
    set(
      this.filter.frequency,
      clamp(
        track.effects.filter,
        20,
        Math.min(20000, this.context.sampleRate * 0.45),
      ),
    );
    set(this.reverbSend.gain, clamp(track.effects.reverb) * 0.6);
    set(this.delaySend.gain, clamp(track.effects.delay) * 0.55);
  }
  dispose() {
    this.nodes.forEach((node) => node.disconnect());
  }
}

/** Wraps a note's nodes. `stop()` with no time fades out over a few milliseconds instead of
 * cutting the waveform mid-cycle, so pausing never clicks. */
function voice(
  context: BaseAudioContext,
  sources: AudioScheduledSourceNode[],
  nodes: AudioNode[],
  out: GainNode,
  done?: (voice: Voice) => void,
): Voice {
  let disposed = false;
  let remaining = sources.length;
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    nodes.forEach((node) => node.disconnect());
    done?.(result);
  };
  const result: Voice = {
    stop(time = 0) {
      const now = context.currentTime;
      const at = time > 0 ? time : now + 0.03;
      if (time === 0) {
        try {
          out.gain.cancelScheduledValues(now);
          out.gain.setTargetAtTime(0, now, 0.006);
        } catch {
          /* the context is closing */
        }
      }
      sources.forEach((source) => {
        try {
          source.stop(at);
        } catch {
          /* already stopped */
        }
      });
    },
  };
  sources.forEach(
    (source) =>
      (source.onended = () => {
        if (--remaining <= 0) cleanup();
      }),
  );
  return result;
}

interface Envelope {
  peak: number;
  attack: number;
  /** Seconds for the level to settle most of the way from the peak to the sustain level. */
  decay: number;
  /** Fraction of the peak held while the note is down. */
  sustain: number;
  release: number;
}
/** Schedules attack, decay, sustain and release for a note of known length. Returns the time
 * the level reaches zero. Short notes are released from wherever the attack had got to. */
function shape(
  parameter: AudioParam,
  start: number,
  end: number,
  envelope: Envelope,
): number {
  const attack = Math.max(0.001, envelope.attack);
  const held = Math.max(0.004, end - start);
  const attackEnd = start + Math.min(attack, held);
  const reached = envelope.peak * Math.min(1, held / attack);
  parameter.setValueAtTime(0, start);
  parameter.linearRampToValueAtTime(reached, attackEnd);
  let level = reached;
  const noteEnd = start + held;
  if (noteEnd > attackEnd + 0.002) {
    const target = envelope.peak * envelope.sustain;
    const constant = Math.max(0.008, envelope.decay / 3);
    parameter.setTargetAtTime(target, attackEnd, constant);
    level =
      target + (reached - target) * Math.exp(-(noteEnd - attackEnd) / constant);
    parameter.setValueAtTime(level, noteEnd);
  }
  // Two segments approximate an exponential tail without leaving a step at the end.
  const release = Math.max(0.012, envelope.release);
  parameter.linearRampToValueAtTime(level * 0.28, noteEnd + release * 0.3);
  parameter.linearRampToValueAtTime(0, noteEnd + release);
  return noteEnd + release;
}

/** Per-instrument level trims so presets sit at similar loudness before the fader. */
const LEVEL: Record<Instrument["type"], number> = {
  "electric-piano": 0.2,
  "felt-piano": 0.26,
  "synth-bass": 0.24,
  "sub-bass": 0.34,
  "synth-pad": 0.26,
  "lead-synth": 0.17,
  pluck: 0.44,
  "drum-kit": 1,
};

export function synthesize(
  context: BaseAudioContext,
  destination: AudioNode,
  instrument: Instrument,
  pitch: number,
  velocity: number,
  start: number,
  duration: number,
  gain = 1,
  done?: (voice: Voice) => void,
): Voice {
  if (instrument.type === "drum-kit")
    return drum(
      context,
      destination,
      instrument,
      pitch,
      velocity,
      start,
      gain,
      done,
    );
  const c = context;
  const frequency = 440 * 2 ** ((pitch - 69) / 12);
  const nyquist = c.sampleRate * 0.45;
  const vel = clamp(velocity, 0.01, 1);
  const bright = clamp(instrument.brightness);
  const attack = clamp(instrument.attack, 0.002, 2);
  const release = clamp(instrument.release, 0.015, 4);
  const end = start + Math.max(0.015, duration);
  // Velocity changes loudness on a curve, as a played instrument does.
  const peak = vel ** 1.35 * clamp(gain, 0, 2) * LEVEL[instrument.type];
  const out = c.createGain();
  out.connect(destination);
  const amp = c.createGain();
  amp.gain.value = 0;
  amp.connect(out);
  const sources: AudioScheduledSourceNode[] = [];
  const nodes: AudioNode[] = [amp, out];
  let tail = end + release;

  const oscillator = (
    type: OscillatorType,
    ratio: number,
    detune: number,
    level: number,
    target: AudioNode | AudioParam,
  ): OscillatorNode => {
    const source = c.createOscillator();
    const amount = c.createGain();
    source.type = type;
    source.frequency.value = Math.min(nyquist, frequency * ratio);
    source.detune.value = detune;
    amount.gain.value = level;
    source.connect(amount);
    // TypeScript sees connect(AudioNode) and connect(AudioParam) as separate overloads.
    if (target instanceof AudioNode) amount.connect(target);
    else amount.connect(target);
    sources.push(source);
    nodes.push(source, amount);
    return source;
  };
  const lowpass = (cutoff: number, q: number): BiquadFilterNode => {
    const filter = c.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = q;
    filter.frequency.value = clamp(cutoff, 40, nyquist);
    nodes.push(filter);
    return filter;
  };
  /** Sweeps a filter from an open position down to its resting cutoff. */
  const sweep = (
    filter: BiquadFilterNode,
    from: number,
    to: number,
    seconds: number,
  ) => {
    filter.frequency.setValueAtTime(clamp(from, 40, nyquist), start);
    filter.frequency.setTargetAtTime(
      clamp(to, 40, nyquist),
      start + 0.002,
      Math.max(0.01, seconds / 3),
    );
  };

  switch (instrument.type) {
    case "electric-piano": {
      // Two-operator FM, the way a tine piano is usually modelled: the modulation index starts
      // high and falls quickly, so hard notes bark and then mellow into a round sustain.
      const tone = lowpass(1800 + bright * 5600 + vel * 2200, 0.4);
      // In-phase FM leaves a DC offset that moves with the index; block it before the
      // envelope so it cannot turn into a thump on every note.
      const block = c.createBiquadFilter();
      block.type = "highpass";
      block.frequency.value = 38;
      // Low notes sit a little left and high notes a little right, like the instrument's output.
      const place = c.createStereoPanner();
      place.pan.value = clamp((pitch - 60) / 60, -0.3, 0.3);
      tone.connect(block);
      block.connect(place);
      place.connect(amp);
      nodes.push(block, place);
      const body = oscillator("sine", 1, -2, 0.82, tone);
      const index = c.createGain();
      const modulator = c.createOscillator();
      modulator.frequency.value = frequency;
      const depth = frequency * (1.2 + bright * 2.6) * (0.4 + vel * 0.9);
      index.gain.setValueAtTime(depth, start);
      index.gain.setTargetAtTime(depth * 0.42, start + 0.004, 0.18);
      modulator.connect(index);
      index.connect(body.frequency);
      sources.push(modulator);
      nodes.push(modulator, index);
      // The tine: a high, fast-fading partial that gives the note its bell.
      const tine = c.createGain();
      tine.gain.setValueAtTime(0.3 * (0.3 + vel * 0.9) * (0.4 + bright), start);
      tine.gain.setTargetAtTime(0, start + 0.003, 0.13);
      tine.connect(tone);
      nodes.push(tine);
      oscillator("sine", 4, 3, 1, tine);
      oscillator("sine", 1, 3, 0.3, tone);
      tail = shape(amp.gain, start, end, {
        peak,
        attack,
        decay: 2.6,
        sustain: 0.18,
        release,
      });
      break;
    }
    case "felt-piano": {
      // Soft hammers: the filter opens for an instant and closes, leaving a muted fundamental.
      const cutoff = 520 + bright * 2400 + vel * 900;
      const tone = lowpass(cutoff, 0.6);
      sweep(tone, cutoff * (2.2 + vel * 2), cutoff, 0.16);
      tone.connect(amp);
      oscillator("triangle", 1, -3, 0.7, tone);
      oscillator("triangle", 1, 4, 0.5, tone);
      oscillator("sine", 2, 0, 0.16, tone);
      oscillator("sine", 3, 0, 0.05, tone);
      tail = shape(amp.gain, start, end, {
        peak,
        attack: Math.max(attack, 0.004),
        decay: 1.9,
        sustain: 0.1,
        release,
      });
      break;
    }
    case "synth-bass": {
      // Saw and square into a resonant filter that snaps shut: the "pluck" of a synth bass.
      const cutoff = 220 + bright * 1300 + vel * 520;
      const tone = lowpass(cutoff, 2.4);
      sweep(tone, cutoff * (2.6 + vel * 2.4), cutoff, 0.2);
      tone.connect(amp);
      oscillator("sawtooth", 1, 0, 0.62, tone);
      oscillator("square", 1, -6, 0.26, tone);
      // The fundamental bypasses the filter so the low end stays constant under the sweep.
      oscillator("sine", 1, 0, 0.46, amp);
      tail = shape(amp.gain, start, end, {
        peak,
        attack,
        decay: 0.5,
        sustain: 0.72,
        release,
      });
      break;
    }
    case "sub-bass": {
      // A sine that drops into pitch, then a little saturation so it reads on small speakers.
      const drive = c.createWaveShaper();
      drive.curve = softClip(c);
      const tone = lowpass(180 + bright * 620, 0.6);
      drive.connect(tone);
      tone.connect(amp);
      nodes.push(drive);
      const source = oscillator("sine", 1, 0, 0.92, drive);
      source.frequency.setValueAtTime(
        Math.min(nyquist, frequency * 1.7),
        start,
      );
      source.frequency.exponentialRampToValueAtTime(frequency, start + 0.045);
      oscillator("triangle", 2, 0, 0.06 + bright * 0.1, drive);
      tail = shape(amp.gain, start, end, {
        peak,
        attack: Math.max(attack, 0.004),
        decay: 1.8,
        sustain: 0.5,
        release,
      });
      break;
    }
    case "synth-pad": {
      // Three detuned saws spread across the stereo field, opening slowly.
      const cutoff = 420 + bright * 3600;
      const tone = lowpass(cutoff, 0.7);
      tone.frequency.setValueAtTime(clamp(cutoff * 0.45, 40, nyquist), start);
      tone.frequency.linearRampToValueAtTime(
        clamp(cutoff, 40, nyquist),
        start + Math.max(0.2, attack * 2.2),
      );
      tone.connect(amp);
      const drift = c.createOscillator();
      const driftDepth = c.createGain();
      drift.frequency.value = 0.27 + (pitch % 5) * 0.04;
      driftDepth.gain.value = 5;
      drift.connect(driftDepth);
      sources.push(drift);
      nodes.push(drift, driftDepth);
      [-0.55, 0, 0.55].forEach((position, voiceIndex) => {
        const pan = c.createStereoPanner();
        pan.pan.value = position;
        pan.connect(tone);
        nodes.push(pan);
        const source = oscillator(
          "sawtooth",
          1,
          (voiceIndex - 1) * 9,
          voiceIndex === 1 ? 0.3 : 0.36,
          pan,
        );
        if (voiceIndex !== 1) driftDepth.connect(source.detune);
      });
      oscillator("triangle", 0.5, 0, 0.3, tone);
      tail = shape(amp.gain, start, end, {
        peak,
        attack,
        decay: 1.2,
        sustain: 0.82,
        release,
      });
      break;
    }
    case "lead-synth": {
      const cutoff = 700 + bright * 4200 + vel * 900;
      const tone = lowpass(cutoff, 2.2);
      sweep(tone, cutoff * 1.9, cutoff, 0.25);
      tone.connect(amp);
      const first = oscillator("sawtooth", 1, -5, 0.5, tone);
      const second = oscillator("square", 1, 5, 0.26, tone);
      oscillator("triangle", 0.5, 0, 0.2, tone);
      // Vibrato arrives after the note has settled, as a singer or player would add it.
      const vibrato = c.createOscillator();
      const vibratoDepth = c.createGain();
      vibrato.frequency.value = 5.3;
      vibratoDepth.gain.setValueAtTime(0, start);
      vibratoDepth.gain.setValueAtTime(0, start + 0.22);
      vibratoDepth.gain.linearRampToValueAtTime(14, start + 0.6);
      vibrato.connect(vibratoDepth);
      vibratoDepth.connect(first.detune);
      vibratoDepth.connect(second.detune);
      sources.push(vibrato);
      nodes.push(vibrato, vibratoDepth);
      tail = shape(amp.gain, start, end, {
        peak,
        attack,
        decay: 0.4,
        sustain: 0.78,
        release,
      });
      break;
    }
    case "pluck": {
      // Bright at the pick, dark a moment later, and gone: made for arpeggios and stabs.
      const cutoff = 420 + bright * 1500;
      const tone = lowpass(cutoff, 1.6);
      sweep(tone, cutoff * (4 + vel * 5), cutoff, 0.14);
      tone.connect(amp);
      oscillator("sawtooth", 1, -4, 0.5, tone);
      oscillator("triangle", 1, 4, 0.5, tone);
      oscillator("sine", 2, 0, 0.12, tone);
      tail = shape(amp.gain, start, end, {
        peak,
        attack: Math.min(attack, 0.01),
        decay: 0.55,
        sustain: 0.04,
        release,
      });
      break;
    }
  }
  for (const source of sources) {
    source.start(start);
    source.stop(tail + 0.02);
  }
  return voice(c, sources, nodes, out, done);
}

interface Choke {
  gain: AudioParam;
  until: number;
}
/** The open hi-hat still ringing on each track, so the next hat can close it. */
const openHats = new WeakMap<AudioNode, Choke>();
const HAT_PARTIALS = [3210, 4170, 5410, 6880];

function drum(
  context: BaseAudioContext,
  destination: AudioNode,
  instrument: Instrument,
  pitch: number,
  velocity: number,
  start: number,
  gain: number,
  done?: (voice: Voice) => void,
): Voice {
  const c = context;
  const sources: AudioScheduledSourceNode[] = [];
  const out = c.createGain();
  const nodes: AudioNode[] = [out];
  // Kick and snare stay in the centre; the lighter voices sit slightly to the sides.
  const side = (
    { 42: 0.22, 46: 0.22, 39: -0.1, 37: -0.24 } as Record<number, number>
  )[pitch];
  if (side) {
    const place = c.createStereoPanner();
    place.pan.value = side;
    out.connect(place);
    place.connect(destination);
    nodes.push(place);
  } else out.connect(destination);
  // Quiet hits are darker as well as softer, which is what makes ghost notes sit back.
  const vel = clamp(velocity, 0.01, 1);
  const level = vel ** 1.25 * clamp(gain, 0, 2);
  const tone = clamp(instrument.brightness);
  // The kit's release control stretches or tightens every drum's decay around its default.
  const decay = clamp(instrument.release / 0.35, 0.4, 2.5);

  const hit = (
    frequency: number,
    finish: number,
    drop: number,
    length: number,
    volume: number,
    type: OscillatorType = "sine",
  ) => {
    const source = c.createOscillator();
    const envelope = c.createGain();
    source.type = type;
    source.frequency.setValueAtTime(frequency, start);
    source.frequency.exponentialRampToValueAtTime(finish, start + drop);
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(volume * level, start + 0.0015);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + length);
    source.connect(envelope);
    envelope.connect(out);
    source.start(start);
    source.stop(start + length + 0.01);
    sources.push(source);
    nodes.push(source, envelope);
  };
  const hiss = (
    length: number,
    filterType: BiquadFilterType,
    frequency: number,
    volume: number,
    offset = 0,
    q = 0.7,
  ) => {
    const source = c.createBufferSource();
    source.buffer = noise(c);
    source.loop = true;
    const filter = c.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = Math.min(c.sampleRate * 0.45, frequency);
    filter.Q.value = q;
    const envelope = c.createGain();
    envelope.gain.setValueAtTime(volume * level, start + offset);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + offset + length);
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(out);
    // Starting each hit at a different point in the noise keeps repeated hits from sounding cloned.
    source.start(start + offset, (((start * 977) % 1.5) + 1.5) % 1.5);
    source.stop(start + offset + length + 0.01);
    sources.push(source);
    nodes.push(source, filter, envelope);
  };
  /** Inharmonic square partials through a high-pass: the metallic part of a hi-hat. */
  const metal = (length: number, volume: number) => {
    const envelope = c.createGain();
    const filter = c.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 6200 + tone * 2600;
    envelope.gain.setValueAtTime(volume * level, start);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + length);
    filter.connect(envelope);
    envelope.connect(out);
    nodes.push(filter, envelope);
    for (const partial of HAT_PARTIALS) {
      const source = c.createOscillator();
      source.type = "square";
      source.frequency.value = Math.min(c.sampleRate * 0.45, partial);
      source.connect(filter);
      source.start(start);
      source.stop(start + length + 0.01);
      sources.push(source);
      nodes.push(source);
    }
  };
  const choke = () => {
    const ringing = openHats.get(destination);
    if (!ringing || ringing.until <= start) return;
    // Without cancelAndHoldAtTime a later fade cannot be spliced into a running ramp cleanly,
    // so browsers that lack it simply let the open hat ring.
    if (typeof ringing.gain.cancelAndHoldAtTime !== "function") return;
    try {
      ringing.gain.cancelAndHoldAtTime(start);
      ringing.gain.setTargetAtTime(0, start, 0.008);
    } catch {
      /* the earlier voice has already ended */
    }
    openHats.delete(destination);
  };

  switch (pitch) {
    case 36: {
      // Kick: a sine that falls from the beater's thud to the drum's note, plus a soft click.
      hit(118 + tone * 40, 49, 0.055, 0.36 * decay, 0.86);
      hiss(0.014, "bandpass", 2800 + tone * 2000, 0.34, 0, 1.1);
      break;
    }
    case 38: {
      // Snare: two shell tones under a band of noise for the wires.
      hit(196, 168, 0.04, 0.1 * decay, 0.26, "triangle");
      hit(332, 288, 0.03, 0.06 * decay, 0.12);
      hiss(0.18 * decay, "highpass", 1700 + tone * 1400, 0.7);
      hiss(0.1 * decay, "bandpass", 3800 + tone * 1600, 0.4, 0, 0.9);
      break;
    }
    case 42: {
      choke();
      metal(0.04 * decay, 0.12);
      hiss(0.045 * decay, "highpass", 7400 + tone * 2600, 0.4);
      break;
    }
    case 46: {
      choke();
      const length = 0.3 * decay;
      metal(length, 0.09);
      hiss(length, "highpass", 6800 + tone * 2400, 0.3);
      openHats.set(destination, { gain: out.gain, until: start + length });
      break;
    }
    case 39: {
      // Clap: several hands a few milliseconds apart, then the room.
      [0, 0.009, 0.019, 0.028].forEach((offset, index) =>
        hiss(0.014, "bandpass", 1150 + index * 130, 0.5, offset, 1.4),
      );
      hiss(0.15 * decay, "bandpass", 1350 + tone * 500, 0.4, 0.03, 1.1);
      break;
    }
    default: {
      // Rim click: two short high tones and a tick of noise. Carries the backbeat quietly.
      hit(1720, 1640, 0.01, 0.028 * decay, 0.3, "triangle");
      hit(830, 790, 0.012, 0.045 * decay, 0.38);
      hiss(0.012, "bandpass", 4200 + tone * 1500, 0.24, 0, 1.3);
    }
  }
  return voice(c, sources, nodes, out, done);
}

export function sample(
  context: BaseAudioContext,
  destination: AudioNode,
  buffer: AudioBuffer,
  start: number,
  duration: number,
  offset: number,
  loop: boolean,
  gain: number,
  done?: (voice: Voice) => void,
  skippedSeconds = 0,
): Voice | null {
  const trimStart = clamp(
    offset,
    0,
    Math.max(0, buffer.duration - 1 / buffer.sampleRate),
  );
  const available = buffer.duration - trimStart;
  if (available <= 0 || duration <= 0 || (!loop && skippedSeconds >= available))
    return null;
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = loop;
  source.loopStart = trimStart;
  source.loopEnd = buffer.duration;
  const envelope = context.createGain();
  const length = loop
    ? duration
    : Math.min(duration, available - skippedSeconds);
  const fade = Math.min(0.006, length / 3);
  envelope.gain.setValueAtTime(0, start);
  envelope.gain.linearRampToValueAtTime(clamp(gain, 0, 2), start + fade);
  envelope.gain.setValueAtTime(clamp(gain, 0, 2), start + length - fade);
  envelope.gain.linearRampToValueAtTime(0, start + length);
  const out = context.createGain();
  source.connect(envelope);
  envelope.connect(out);
  out.connect(destination);
  source.start(
    start,
    trimStart + (loop ? skippedSeconds % available : skippedSeconds),
  );
  source.stop(start + length + 0.001);
  return voice(context, [source], [source, envelope, out], out, done);
}
