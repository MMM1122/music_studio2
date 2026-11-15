import type { Track, Instrument } from "../domain/models";

export interface Voice {
  stop(time?: number): void;
}
const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));
const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();
const impulses = new WeakMap<BaseAudioContext, AudioBuffer>();

function noise(context: BaseAudioContext): AudioBuffer {
  const existing = noiseBuffers.get(context);
  if (existing) return existing;
  const buffer = context.createBuffer(
    1,
    context.sampleRate * 2,
    context.sampleRate,
  );
  const data = buffer.getChannelData(0);
  let state = 7319;
  for (let index = 0; index < data.length; index++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    data[index] = (state / 0xffffffff) * 2 - 1;
  }
  noiseBuffers.set(context, buffer);
  return buffer;
}
function impulse(context: BaseAudioContext): AudioBuffer {
  const existing = impulses.get(context);
  if (existing) return existing;
  const length = Math.floor(context.sampleRate * 1.7);
  const buffer = context.createBuffer(2, length, context.sampleRate);
  let state = 137;
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < length; index++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      data[index] =
        ((state / 0xffffffff) * 2 - 1) * Math.pow(1 - index / length, 3.5);
    }
  }
  impulses.set(context, buffer);
  return buffer;
}

/** Effects are allocated once per track and parameters are smoothed in place. */
export class TrackGraph {
  readonly input: GainNode;
  private readonly filter: BiquadFilterNode;
  private readonly pan: StereoPannerNode;
  private readonly output: GainNode;
  private readonly reverb: ConvolverNode;
  private readonly reverbSend: GainNode;
  private readonly delay: DelayNode;
  private readonly delaySend: GainNode;
  private readonly feedback: GainNode;
  private readonly nodes: AudioNode[];
  constructor(
    private readonly context: BaseAudioContext,
    destination: AudioNode,
    track: Track,
    audible: boolean,
    bpm: number,
  ) {
    this.input = context.createGain();
    this.filter = context.createBiquadFilter();
    this.pan = context.createStereoPanner();
    this.output = context.createGain();
    this.reverb = context.createConvolver();
    this.reverb.buffer = impulse(context);
    this.reverbSend = context.createGain();
    this.delay = context.createDelay(2);
    this.delaySend = context.createGain();
    this.feedback = context.createGain();
    this.filter.type = "lowpass";
    this.filter.Q.value = 0.5;
    this.input.connect(this.filter);
    this.filter.connect(this.pan);
    this.pan.connect(this.output);
    this.output.connect(destination);
    this.filter.connect(this.reverbSend);
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(this.pan);
    this.filter.connect(this.delaySend);
    this.delaySend.connect(this.delay);
    this.delay.connect(this.pan);
    this.delay.connect(this.feedback);
    this.feedback.connect(this.delay);
    this.feedback.gain.value = 0.3;
    this.nodes = [
      this.input,
      this.filter,
      this.pan,
      this.output,
      this.reverb,
      this.reverbSend,
      this.delay,
      this.delaySend,
      this.feedback,
    ];
    this.update(track, audible, bpm, true);
  }
  update(track: Track, audible: boolean, bpm: number, immediate = false) {
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
    set(this.reverbSend.gain, clamp(track.effects.reverb) * 0.55);
    set(this.delaySend.gain, clamp(track.effects.delay) * 0.5);
    set(this.delay.delayTime, (60 / bpm) * 0.75);
  }
  dispose() {
    this.nodes.forEach((node) => node.disconnect());
  }
}

function voice(
  sources: AudioScheduledSourceNode[],
  nodes: AudioNode[],
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
      sources.forEach((source) => {
        try {
          source.stop(time);
        } catch {
          /* already stopped */
        }
      });
      if (time === 0) cleanup();
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
    return drum(context, destination, pitch, velocity, start, gain, done);
  const frequency = 440 * 2 ** ((pitch - 69) / 12);
  const envelope = context.createGain();
  const tone = context.createBiquadFilter();
  const attack = clamp(instrument.attack, 0.002, 2);
  const release = clamp(instrument.release, 0.015, 2);
  const noteDuration = Math.max(0.015, duration);
  const end = start + noteDuration;
  const peak =
    clamp(velocity) *
    clamp(gain, 0, 2) *
    (instrument.type === "synth-pad" ? 0.13 : 0.19);
  const attackEnd = start + Math.min(attack, noteDuration * 0.5);
  envelope.gain.setValueAtTime(0, start);
  envelope.gain.linearRampToValueAtTime(peak, attackEnd);
  if (instrument.type === "electric-piano") {
    envelope.gain.exponentialRampToValueAtTime(
      Math.max(0.0001, peak * 0.38),
      Math.max(attackEnd + 0.001, end),
    );
  } else envelope.gain.setValueAtTime(peak * 0.85, Math.max(attackEnd, end));
  envelope.gain.linearRampToValueAtTime(0, end + release);
  tone.type = "lowpass";
  tone.Q.value = instrument.type === "synth-bass" ? 1.2 : 0.3;
  const brightness = clamp(instrument.brightness);
  tone.frequency.setValueAtTime(
    Math.min(
      context.sampleRate * 0.45,
      (instrument.type === "synth-bass" ? 160 : 650) +
        brightness * (instrument.type === "synth-bass" ? 3800 : 13000),
    ),
    start,
  );
  tone.connect(envelope);
  envelope.connect(destination);
  const sources: OscillatorNode[] = [];
  const nodes: AudioNode[] = [tone, envelope];
  const add = (
    type: OscillatorType,
    ratio: number,
    detune: number,
    level: number,
  ) => {
    const oscillator = context.createOscillator();
    const amplitude = context.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency * ratio;
    oscillator.detune.value = detune;
    amplitude.gain.value = level;
    oscillator.connect(amplitude);
    amplitude.connect(tone);
    oscillator.start(start);
    oscillator.stop(end + release + 0.01);
    sources.push(oscillator);
    nodes.push(oscillator, amplitude);
  };
  switch (instrument.type) {
    case "electric-piano":
      add("sine", 1, 0, 0.8);
      add("sine", 2, 1.2, 0.18);
      add("sine", 3, -1.8, 0.07);
      break;
    case "synth-bass":
      add("triangle", 1, 0, 0.9);
      add("sine", 0.5, 0, 0.32);
      add("sawtooth", 1, 0, 0.16);
      break;
    case "synth-pad":
      add("sawtooth", 1, -7, 0.37);
      add("sawtooth", 1, 7, 0.37);
      add("triangle", 0.5, 0, 0.26);
      break;
    case "lead-synth":
      add("triangle", 1, 0, 0.7);
      add("sawtooth", 1, 3, 0.3);
      break;
  }
  return voice(sources, nodes, done);
}

function drum(
  context: BaseAudioContext,
  destination: AudioNode,
  pitch: number,
  velocity: number,
  start: number,
  gain: number,
  done?: (voice: Voice) => void,
): Voice {
  const sources: AudioScheduledSourceNode[] = [];
  const nodes: AudioNode[] = [];
  const level = clamp(velocity) * clamp(gain, 0, 2);
  const oscillator = (
    frequency: number,
    finish: number,
    length: number,
    volume: number,
    type: OscillatorType = "sine",
  ) => {
    const source = context.createOscillator();
    const envelope = context.createGain();
    source.type = type;
    source.frequency.setValueAtTime(frequency, start);
    source.frequency.exponentialRampToValueAtTime(finish, start + length * 0.8);
    envelope.gain.setValueAtTime(volume * level, start);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + length);
    source.connect(envelope);
    envelope.connect(destination);
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
  ) => {
    const source = context.createBufferSource();
    source.buffer = noise(context);
    const filter = context.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = frequency;
    filter.Q.value = 0.6;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(volume * level, start + offset);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + offset + length);
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(destination);
    source.start(start + offset);
    source.stop(start + offset + length + 0.01);
    sources.push(source);
    nodes.push(source, filter, envelope);
  };
  switch (pitch) {
    case 36:
      oscillator(145, 42, 0.42, 0.85);
      hiss(0.015, "lowpass", 2000, 0.12);
      break;
    case 38:
      oscillator(185, 95, 0.14, 0.27, "triangle");
      hiss(0.18, "highpass", 1600, 0.45);
      break;
    case 42:
      hiss(0.055, "highpass", 6500, 0.2);
      break;
    case 46:
      hiss(0.33, "highpass", 6000, 0.23);
      break;
    case 39:
      hiss(0.11, "bandpass", 1700, 0.34);
      hiss(0.08, "bandpass", 2100, 0.3, 0.017);
      hiss(0.12, "bandpass", 1850, 0.25, 0.033);
      break;
    default:
      oscillator(510, 280, 0.095, 0.32, "triangle");
      hiss(0.035, "bandpass", 3200, 0.1);
  }
  return voice(sources, nodes, done);
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
  source.connect(envelope);
  envelope.connect(destination);
  source.start(
    start,
    trimStart + (loop ? skippedSeconds % available : skippedSeconds),
  );
  source.stop(start + length + 0.001);
  return voice([source], [source, envelope], done);
}
