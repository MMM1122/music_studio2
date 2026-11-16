import { harmonicLevels } from "../math/fourier";
import * as Tone from "tone";
import {
  BAR,
  INSTRUMENTS,
  PPQ,
  type Instrument,
  type InstrumentType,
  type Pattern,
  type Project,
  type Track,
} from "../domain/models";
import {
  collectEvents,
  eventsCrossingTick,
  isTrackAudible,
  arrangementEndTick,
  ticksToSeconds,
  secondsToTicks,
  type MusicalEvent,
} from "./scheduler";
import { MixBus, TrackGraph, sample, synthesize, type Voice } from "./graph";
import { encodeWav } from "./wav";

export const EXPORT_TAIL_SECONDS = 2;
export const EXPORT_SAMPLE_RATE = 44100;
/** Seconds of release rendered past a previewed pattern and folded back onto its start. */
const PREVIEW_TAIL_SECONDS = 1.5;

function presetInstrument(type: InstrumentType): Instrument {
  const preset =
    INSTRUMENTS.find((item) => item.type === type) ?? INSTRUMENTS[0];
  return {
    type: preset.type,
    attack: preset.attack,
    release: preset.release,
    brightness: preset.brightness,
  };
}

/** Audio resources live here, never in the serializable project store.
 * Tone's transport supplies audio-clock timestamps; React only reads the playhead.
 * Native synthesis and effects are shared by realtime and offline rendering. */
export class StudioAudioEngine {
  private labPending = new Map<number, symbol>();
  private labVoices = new Map<
    number,
    {
      sources: OscillatorNode[];
      amounts: GainNode[];
      envelope: GainNode;
      release: number;
    }
  >();
  private context: AudioContext | null = null;
  private transport: ReturnType<typeof Tone.getTransport> | null = null;
  private bus: MixBus | null = null;
  private analyser: AnalyserNode | null = null;
  private meterData = new Float32Array(256);
  private tracks = new Map<string, TrackGraph>();
  private assets = new Map<string, AudioBuffer>();
  private voices = new Set<Voice>();
  private previewVoices = new Set<Voice>();
  private previewGraph: TrackGraph | null = null;
  private previewSource: AudioBufferSourceNode | null = null;
  private previewSerial = 0;
  private previewStart = 0;
  private previewBpm = 90;
  private previewLength = BAR;
  private auditionGraph: TrackGraph | null = null;
  private auditionSignature = "";
  private auditionVoices = new Set<Voice>();
  private project: Project | null = null;
  private events: MusicalEvent[] = [];
  private eventIds: number[] = [];
  private playing = false;
  private position = 0;
  private commandSerial = 0;
  private structure = "";
  private transportConfig = "";

  async init(): Promise<void> {
    if (typeof window === "undefined")
      throw new Error("Audio is available in a browser.");
    // This call is reached from a user gesture (Play, audition, preview, or export).
    await Tone.start();
    if (this.context) return;
    this.context = Tone.getContext().rawContext as AudioContext;
    Tone.getContext().lookAhead = 0.06;
    this.transport = Tone.getTransport();
    this.transport.PPQ = PPQ;
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.connect(this.context.destination);
    this.bus = new MixBus(
      this.context,
      this.analyser,
      this.project?.masterVolume ?? 0.8,
      this.project?.transport.bpm ?? 90,
    );
  }

  async play(project: Project, startTick?: number): Promise<void> {
    this.stopLabNotes();
    const command = ++this.commandSerial;
    await this.init();
    if (command !== this.commandSerial || !this.transport || !this.context)
      return;
    this.stopPreview();
    this.haltVoices();
    this.transport.stop(this.context.currentTime);
    this.project = project;
    this.syncGraphs(project);
    this.position = Math.max(0, startTick ?? this.position);
    const end = arrangementEndTick(project);
    if (!project.transport.loop && this.position >= end) this.position = 0;
    if (project.transport.loop && this.position >= project.transport.loopEnd)
      this.position = project.transport.loopStart;
    this.configureTransport(project);
    this.schedule(project);
    const when = this.context.currentTime + 0.08;
    this.playing = true;
    this.transport.start(when, `${this.position}i`);
    if (
      !(project.transport.loop && this.position === project.transport.loopStart)
    )
      this.resumeCrossing(this.position, when);
  }

  pause(): void {
    ++this.commandSerial;
    if (this.playing) this.position = this.readTick();
    this.playing = false;
    this.transport?.pause(this.context?.currentTime);
    this.haltVoices();
  }

  stop(): void {
    this.stopLabNotes();
    ++this.commandSerial;
    this.playing = false;
    this.position = 0;
    this.transport?.stop(this.context?.currentTime);
    this.haltVoices();
    this.stopPreview();
  }

  seek(tick: number): void {
    this.position = Math.max(0, Math.round(tick));
    if (!this.project || !this.transport || !this.context) return;
    const wasPlaying = this.playing;
    this.transport.stop(this.context.currentTime);
    this.haltVoices();
    if (wasPlaying) {
      const when = this.context.currentTime + 0.08;
      this.transport.start(when, `${this.position}i`);
      if (
        !(
          this.project.transport.loop &&
          this.position === this.project.transport.loopStart
        )
      )
        this.resumeCrossing(this.position, when);
    }
  }

  /** Applies an edited project. Mix and effect changes glide in place. When notes, clips or the
   * loop change, only the plan for the future is replaced: the transport keeps running and
   * notes already sounding finish naturally, so editing during playback never drops out. */
  update(project: Project): void {
    const prior = this.project;
    if (prior && prior.id !== project.id) this.stop();
    this.project = project;
    if (!this.context || !this.transport) return;
    this.syncGraphs(project);
    this.configureTransport(project);
    if (this.schedulingSignature(project) !== this.structure)
      this.schedule(project);
    if (
      !this.playing &&
      project.transport.loop &&
      this.position >= project.transport.loopEnd
    )
      this.position = project.transport.loopStart;
  }

  getTick(): number {
    if (!this.playing) return this.position;
    const tick = this.readTick();
    if (
      this.project &&
      !this.project.transport.loop &&
      tick >= arrangementEndTick(this.project)
    ) {
      this.position = arrangementEndTick(this.project);
      this.playing = false;
      this.transport?.stop(this.context?.currentTime);
      // Already scheduled releases and effect tails are allowed to finish naturally.
      return this.position;
    }
    return tick;
  }
  isPlaying(): boolean {
    this.getTick();
    return this.playing;
  }
  getLevel(): number {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this.meterData);
    let sum = 0;
    for (const sample of this.meterData) sum += sample * sample;
    return Math.min(1, Math.sqrt(sum / this.meterData.length));
  }

  /** Eight phase-aligned sine partials let held notes respond to harmonic sliders
   * with gain glides. Sequenced notes use the equivalent PeriodicWave in graph.ts. */
  async labNoteOn(
    instrument: Instrument,
    pitch: number,
    volume: number,
  ): Promise<void> {
    this.labNoteOff(pitch);
    const request = Symbol();
    this.labPending.set(pitch, request);
    this.pause();
    this.stopPreview();
    await this.init();
    if (this.labPending.get(pitch) !== request || !this.context || !this.bus)
      return;
    this.labPending.delete(pitch);
    const c = this.context,
      now = c.currentTime + 0.005;
    const envelope = c.createGain();
    envelope.gain.value = 0;
    // Same context and master metering; isolated from the session's reverb sends.
    envelope.connect(this.bus.input);
    envelope.gain.setValueAtTime(0, now);
    envelope.gain.linearRampToValueAtTime(
      Math.max(0, Math.min(1, volume)) * 0.3,
      now + Math.max(0.008, instrument.attack),
    );
    const levels = harmonicLevels(
      instrument.harmonics ?? [1, 0, 0, 0, 0, 0, 0, 0],
    );
    const sources: OscillatorNode[] = [],
      amounts: GainNode[] = [];
    for (let i = 0; i < 8; i++) {
      const oscillator = c.createOscillator(),
        amount = c.createGain();
      const frequency = 440 * 2 ** ((pitch - 69) / 12) * (i + 1);
      oscillator.frequency.value = Math.min(frequency, c.sampleRate * 0.45);
      amount.gain.value = frequency < c.sampleRate * 0.45 ? levels[i] : 0;
      oscillator.connect(amount);
      amount.connect(envelope);
      sources.push(oscillator);
      amounts.push(amount);
      oscillator.start(now);
      oscillator.stop(now + 30);
    }
    const entry = { sources, amounts, envelope, release: instrument.release };
    this.labVoices.set(pitch, entry);
    sources[0].onended = () => {
      sources.forEach((s) => s.disconnect());
      amounts.forEach((g) => g.disconnect());
      envelope.disconnect();
      if (this.labVoices.get(pitch) === entry) this.labVoices.delete(pitch);
    };
  }
  labNoteOff(pitch: number): void {
    this.labPending.delete(pitch);
    const entry = this.labVoices.get(pitch);
    if (!entry || !this.context) return;
    this.labVoices.delete(pitch);
    const now = this.context.currentTime,
      release = Math.min(1.5, Math.max(0.02, entry.release));
    const gain = entry.envelope.gain;
    if (typeof gain.cancelAndHoldAtTime === "function")
      gain.cancelAndHoldAtTime(now);
    else {
      const value = gain.value;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(value, now);
    }
    gain.linearRampToValueAtTime(0, now + release);
    entry.sources.forEach((s) => {
      try {
        s.stop(now + release + 0.02);
      } catch {
        /* already stopped */
      }
    });
  }
  stopLabNotes(): void {
    this.labPending.clear();
    for (const [pitch, entry] of this.labVoices) {
      entry.release = 0.025;
      this.labNoteOff(pitch);
    }
  }
  updateLabSound(instrument: Instrument, volume: number): void {
    if (!this.context) return;
    const now = this.context.currentTime,
      levels = harmonicLevels(instrument.harmonics ?? [1, 0, 0, 0, 0, 0, 0, 0]);
    for (const entry of this.labVoices.values()) {
      entry.release = instrument.release;
      entry.amounts.forEach((g, i) =>
        g.gain.setTargetAtTime(levels[i], now, 0.018),
      );
      entry.envelope.gain.cancelScheduledValues(now);
      entry.envelope.gain.setTargetAtTime(
        Math.max(0, Math.min(1, volume)) * 0.3,
        now,
        0.018,
      );
    }
  }

  async audition(track: Track, pitch: number, velocity = 0.8): Promise<void> {
    await this.init();
    if (!this.context || !this.bus) return;
    const signature = JSON.stringify([track.id, track.instrument]);
    if (!this.auditionGraph || signature !== this.auditionSignature) {
      this.auditionVoices.forEach((voice) => voice.stop());
      this.auditionVoices.clear();
      this.auditionGraph?.dispose();
      this.auditionGraph = new TrackGraph(this.context, this.bus, track, true);
      this.auditionSignature = signature;
    }
    this.auditionGraph.update(track, true);
    const voice = synthesize(
      this.context,
      this.auditionGraph.input,
      track.instrument,
      pitch,
      velocity,
      this.context.currentTime + 0.01,
      0.45,
      1,
      (ended) => this.auditionVoices.delete(ended),
    );
    this.auditionVoices.add(voice);
  }

  /** Loops one pattern on its own. Pass the track's instrument to hear it as the track plays
   * it, or a preset name to hear an idea before it has a track. */
  async previewPattern(
    project: Project,
    pattern: Pattern,
    instrument?: Instrument | InstrumentType,
  ): Promise<void> {
    this.stopLabNotes();
    this.pause();
    this.stopPreview();
    const command = this.previewSerial;
    await this.init();
    if (command !== this.previewSerial || !this.context || !this.bus) return;
    const requested =
      typeof instrument === "object"
        ? instrument
        : presetInstrument(instrument ?? "electric-piano");
    const drums = pattern.kind === "drums";
    const sound =
      drums === (requested.type === "drum-kit")
        ? requested
        : presetInstrument(drums ? "drum-kit" : "electric-piano");
    const preset = INSTRUMENTS.find((item) => item.type === sound.type);
    const track: Track = {
      id: "preview",
      name: "Preview",
      type: pattern.kind === "drums" ? "drums" : "midi",
      color: "sage",
      instrument: sound,
      mixer: { volume: 0.8, pan: 0, mute: false, solo: false },
      effects: { reverb: preset?.reverb ?? 0.12, delay: 0, filter: 16000 },
      clips: [
        {
          id: "preview-clip",
          type: "midi",
          name: pattern.name,
          startTick: 0,
          durationTicks: pattern.lengthTicks,
          loop: false,
          gain: 1,
          patternId: pattern.id,
        },
      ],
    };
    const duration = ticksToSeconds(pattern.lengthTicks, project.transport.bpm);
    const loopFrames = Math.max(1, Math.round(duration * EXPORT_SAMPLE_RATE));
    const render = new OfflineAudioContext(
      2,
      loopFrames + Math.ceil(PREVIEW_TAIL_SECONDS * EXPORT_SAMPLE_RATE),
      EXPORT_SAMPLE_RATE,
    );
    for (const event of collectEvents({
      ...project,
      tracks: [track],
      patterns: { [pattern.id]: pattern },
    }))
      if (event.type === "note") {
        synthesize(
          render,
          render.destination,
          track.instrument,
          event.pitch,
          event.velocity,
          ticksToSeconds(event.startTick, project.transport.bpm),
          ticksToSeconds(event.durationTicks, project.transport.bpm),
          event.gain,
        );
      }
    const rendered = await render.startRendering();
    if (command !== this.previewSerial || !this.context || !this.bus) return;
    // Fold the release tail back onto the start, so the loop point has no cut-off notes.
    const buffer = this.context.createBuffer(2, loopFrames, EXPORT_SAMPLE_RATE);
    for (let channel = 0; channel < 2; channel++) {
      const source = rendered.getChannelData(channel);
      const target = buffer.getChannelData(channel);
      target.set(source.subarray(0, loopFrames));
      for (let index = loopFrames; index < source.length; index++)
        target[(index - loopFrames) % loopFrames] += source[index];
    }
    this.bus.update(project.masterVolume, project.transport.bpm);
    this.previewGraph = new TrackGraph(this.context, this.bus, track, true);
    this.previewSource = this.context.createBufferSource();
    this.previewSource.buffer = buffer;
    this.previewSource.loop = true;
    this.previewSource.connect(this.previewGraph.input);
    this.previewStart = this.context.currentTime + 0.02;
    this.previewBpm = project.transport.bpm;
    this.previewLength = pattern.lengthTicks;
    this.previewSource.start(this.previewStart);
  }

  isPreviewing(): boolean {
    return this.previewSource !== null || this.previewVoices.size > 0;
  }
  getPreviewTick(): number {
    return this.previewSource && this.context
      ? Math.max(
          0,
          secondsToTicks(
            this.context.currentTime - this.previewStart,
            this.previewBpm,
          ),
        ) % this.previewLength
      : 0;
  }
  stopPreview(): void {
    ++this.previewSerial;
    if (this.previewSource) {
      try {
        this.previewSource.stop();
      } catch {
        /* already stopped */
      }
      this.previewSource.disconnect();
      this.previewSource = null;
    }
    this.previewVoices.forEach((voice) => voice.stop());
    this.previewVoices.clear();
    this.previewGraph?.dispose();
    this.previewGraph = null;
  }

  async loadAsset(id: string, data: ArrayBuffer): Promise<void> {
    // Decode on an offline context so restoring saved samples never requests audio activation.
    const decoder = new OfflineAudioContext(1, 1, EXPORT_SAMPLE_RATE);
    const decoded = await decoder.decodeAudioData(data.slice(0));
    this.assets.set(id, decoded);
  }
  unloadAsset(id: string): void {
    this.assets.delete(id);
  }
  hasAsset(id: string): boolean {
    return this.assets.has(id);
  }
  getWaveform(id: string, points = 80): number[] {
    const buffer = this.assets.get(id);
    if (!buffer) return [];
    const data = buffer.getChannelData(0);
    const size = Math.max(1, Math.floor(data.length / points));
    return Array.from({ length: points }, (_, i) => {
      let peak = 0;
      for (let j = i * size; j < Math.min(data.length, (i + 1) * size); j++)
        peak = Math.max(peak, Math.abs(data[j]));
      return peak;
    });
  }

  async previewAsset(id: string): Promise<void> {
    await this.init();
    this.stopPreview();
    if (!this.context || !this.bus) return;
    const buffer = this.assets.get(id);
    if (!buffer)
      throw new Error("This sample is not available locally. Import it again.");
    const voice = sample(
      this.context,
      this.bus.input,
      buffer,
      this.context.currentTime + 0.02,
      Math.min(buffer.duration, 12),
      0,
      false,
      0.75,
      (ended) => this.previewVoices.delete(ended),
    );
    if (voice) this.previewVoices.add(voice);
  }

  async exportWav(
    project: Project,
    onProgress?: (value: number) => void,
  ): Promise<Blob> {
    const events = collectEvents(project);
    for (const event of events)
      if (
        event.type === "audio" &&
        isTrackAudible(project, event.trackId) &&
        !this.assets.has(event.assetId)
      ) {
        throw new Error(
          `Cannot export: the sample “${project.assets.find((asset) => asset.id === event.assetId)?.name ?? event.assetId}” is missing from this browser. Import it again.`,
        );
      }
    const duration =
      ticksToSeconds(arrangementEndTick(project), project.transport.bpm) +
      EXPORT_TAIL_SECONDS;
    if (duration > 600)
      throw new Error(
        "Export is limited to 10 minutes to protect browser memory. Shorten the arrangement.",
      );
    onProgress?.(0.05);
    const context = new OfflineAudioContext(
      2,
      Math.ceil(duration * EXPORT_SAMPLE_RATE),
      EXPORT_SAMPLE_RATE,
    );
    // The same bus and instruments as playback, so the file sounds like what was heard.
    const bus = new MixBus(
      context,
      context.destination,
      project.masterVolume,
      project.transport.bpm,
    );
    const graphs = new Map<string, TrackGraph>();
    const tracks = new Map(project.tracks.map((track) => [track.id, track]));
    for (const track of project.tracks)
      graphs.set(
        track.id,
        new TrackGraph(context, bus, track, isTrackAudible(project, track.id)),
      );
    for (const event of events) {
      if (!isTrackAudible(project, event.trackId)) continue;
      const graph = graphs.get(event.trackId);
      const track = tracks.get(event.trackId);
      if (!graph || !track) continue;
      const start = ticksToSeconds(event.startTick, project.transport.bpm);
      const length = ticksToSeconds(event.durationTicks, project.transport.bpm);
      if (event.type === "note")
        synthesize(
          context,
          graph.input,
          track.instrument,
          event.pitch,
          event.velocity,
          start,
          length,
          event.gain,
        );
      else {
        const buffer = this.assets.get(event.assetId);
        if (buffer)
          sample(
            context,
            graph.input,
            buffer,
            start,
            length,
            event.offsetSeconds,
            event.loop,
            event.gain,
          );
      }
    }
    onProgress?.(0.25);
    try {
      const rendered = await context.startRendering();
      onProgress?.(0.85);
      const wave = encodeWav(
        [rendered.getChannelData(0), rendered.getChannelData(1)],
        rendered.sampleRate,
      );
      onProgress?.(1);
      return new Blob([wave], { type: "audio/wav" });
    } finally {
      graphs.forEach((graph) => graph.dispose());
      bus.dispose();
    }
  }

  dispose(): void {
    this.stop();
    this.clearSchedules();
    this.auditionVoices.forEach((voice) => voice.stop());
    this.auditionVoices.clear();
    this.auditionGraph?.dispose();
    this.auditionGraph = null;
    this.tracks.forEach((graph) => graph.dispose());
    this.tracks.clear();
    this.bus?.dispose();
    this.analyser?.disconnect();
    this.bus = null;
    this.analyser = null;
    this.context = null;
    this.transport = null;
    this.project = null;
    this.structure = "";
    this.transportConfig = "";
    this.assets.clear();
  }

  private readTick(): number {
    if (!this.transport || !this.context) return this.position;
    return Math.max(0, this.transport.getTicksAtTime(this.context.currentTime));
  }
  private haltVoices(): void {
    this.voices.forEach((voice) => voice.stop());
    this.voices.clear();
  }
  private configureTransport(project: Project): void {
    if (!this.transport) return;
    // Called on every project change; writing only real differences keeps Tone's tempo
    // automation from accumulating an event for each unrelated edit.
    const next = JSON.stringify(project.transport);
    if (next === this.transportConfig) return;
    this.transportConfig = next;
    this.transport.bpm.value = project.transport.bpm;
    this.transport.timeSignature = project.transport.timeSignature;
    this.transport.loop = project.transport.loop;
    this.transport.loopStart = `${project.transport.loopStart}i`;
    this.transport.loopEnd = `${Math.max(project.transport.loopStart + PPQ, project.transport.loopEnd)}i`;
  }
  private syncGraphs(project: Project): void {
    if (!this.context || !this.bus) return;
    this.bus.update(project.masterVolume, project.transport.bpm);
    for (const [id, graph] of this.tracks)
      if (!project.tracks.some((track) => track.id === id)) {
        graph.dispose();
        this.tracks.delete(id);
      }
    for (const track of project.tracks) {
      let graph = this.tracks.get(track.id);
      if (!graph) {
        graph = new TrackGraph(
          this.context,
          this.bus,
          track,
          isTrackAudible(project, track.id),
        );
        this.tracks.set(track.id, graph);
      } else graph.update(track, isTrackAudible(project, track.id));
    }
  }
  /** Everything that decides which events exist and when. Tempo and instrument settings are
   * left out on purpose: events are placed in ticks and read the instrument when they sound. */
  private schedulingSignature(project: Project): string {
    return JSON.stringify([
      project.id,
      project.transport.loop,
      project.transport.loopStart,
      project.transport.loopEnd,
      project.patterns,
      project.tracks.map((track) => [track.id, track.clips]),
    ]);
  }
  private clearSchedules(): void {
    if (this.transport)
      this.eventIds.forEach((id) => this.transport?.clear(id));
    this.eventIds = [];
  }
  private schedule(project: Project): void {
    if (!this.transport) return;
    this.clearSchedules();
    this.events = collectEvents(project);
    this.structure = this.schedulingSignature(project);
    for (const event of this.events)
      this.eventIds.push(
        this.transport.schedule(
          (time) => this.emit(event, time),
          `${event.startTick}i`,
        ),
      );
    if (project.transport.loop)
      this.eventIds.push(
        this.transport.schedule(
          (time) => this.resumeCrossing(project.transport.loopStart, time),
          `${project.transport.loopStart}i`,
        ),
      );
  }
  private resumeCrossing(tick: number, time: number): void {
    for (const event of eventsCrossingTick(this.events, tick))
      this.emit(event, time, tick - event.startTick);
  }
  private emit(event: MusicalEvent, time: number, skippedTicks = 0): void {
    if (!this.context || !this.project || !this.playing) return;
    const track = this.project.tracks.find((item) => item.id === event.trackId);
    const graph = this.tracks.get(event.trackId);
    if (!track || !graph) return;
    const startTick = event.startTick + skippedTicks;
    const remainingTicks = this.project.transport.loop
      ? Math.min(
          event.durationTicks - skippedTicks,
          this.project.transport.loopEnd - startTick,
        )
      : event.durationTicks - skippedTicks;
    const duration = ticksToSeconds(remainingTicks, this.project.transport.bpm);
    if (duration <= 0) return;
    const when = Math.max(this.context.currentTime, time);
    let voice: Voice | null;
    if (event.type === "note")
      voice = synthesize(
        this.context,
        graph.input,
        track.instrument,
        event.pitch,
        event.velocity,
        when,
        duration,
        event.gain,
        (ended) => this.voices.delete(ended),
      );
    else {
      const buffer = this.assets.get(event.assetId);
      if (!buffer) return;
      voice = sample(
        this.context,
        graph.input,
        buffer,
        when,
        duration,
        event.offsetSeconds,
        event.loop,
        event.gain,
        (ended) => this.voices.delete(ended),
        ticksToSeconds(skippedTicks, this.project.transport.bpm),
      );
    }
    if (voice) this.voices.add(voice);
  }
}

export const engine = new StudioAudioEngine();
// Expose pure timing/export primitives for integration tests and consumers.
export {
  ticksToSeconds,
  secondsToTicks,
  arrangementEndTick,
  collectEvents,
  encodeWav,
  BAR,
};
