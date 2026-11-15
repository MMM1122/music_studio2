import * as Tone from "tone";
import {
  BAR,
  PPQ,
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
import { TrackGraph, sample, synthesize, type Voice } from "./graph";
import { encodeWav } from "./wav";

export const EXPORT_TAIL_SECONDS = 2;
export const EXPORT_SAMPLE_RATE = 44100;

/** Audio resources live here, never in the serializable project store.
 * Tone's transport supplies audio-clock timestamps; React only reads the playhead.
 * Native synthesis and effects are shared by realtime and offline rendering. */
export class StudioAudioEngine {
  private context: AudioContext | null = null;
  private transport: ReturnType<typeof Tone.getTransport> | null = null;
  private master: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
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
    this.master = this.context.createGain();
    this.master.gain.value = 0.8;
    this.limiter = this.context.createDynamicsCompressor();
    this.limiter.threshold.value = -3;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.1;
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 256;
    this.master.connect(this.limiter);
    this.limiter.connect(this.analyser);
    this.analyser.connect(this.context.destination);
  }

  async play(project: Project, startTick?: number): Promise<void> {
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

  update(project: Project): void {
    const prior = this.project;
    const changedProject = !!prior && prior.id !== project.id;
    if (changedProject) this.stop();
    const tick = this.playing ? this.readTick() : this.position;
    this.project = project;
    if (!this.context || !this.transport) return;
    this.syncGraphs(project);
    const signature = this.schedulingSignature(project);
    const changed = signature !== this.structure;
    if (changed) {
      const wasPlaying = this.playing;
      this.transport.stop(this.context.currentTime);
      this.haltVoices();
      this.configureTransport(project);
      this.schedule(project);
      this.position =
        project.transport.loop && tick >= project.transport.loopEnd
          ? project.transport.loopStart
          : tick;
      if (wasPlaying) {
        const when = this.context.currentTime + 0.08;
        this.transport.start(when, `${this.position}i`);
        if (
          !(
            project.transport.loop &&
            this.position === project.transport.loopStart
          )
        )
          this.resumeCrossing(this.position, when);
      }
    }
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

  async audition(track: Track, pitch: number, velocity = 0.8): Promise<void> {
    await this.init();
    if (!this.context || !this.master) return;
    const signature = JSON.stringify([track.id, track.instrument]);
    if (!this.auditionGraph || signature !== this.auditionSignature) {
      this.auditionVoices.forEach((voice) => voice.stop());
      this.auditionVoices.clear();
      this.auditionGraph?.dispose();
      this.auditionGraph = new TrackGraph(
        this.context,
        this.master,
        track,
        true,
        this.project?.transport.bpm ?? 90,
      );
      this.auditionSignature = signature;
    }
    this.auditionGraph.update(track, true, this.project?.transport.bpm ?? 90);
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

  async previewPattern(
    project: Project,
    pattern: Pattern,
    instrument: InstrumentType = pattern.kind === "drums"
      ? "drum-kit"
      : "electric-piano",
  ): Promise<void> {
    this.pause();
    this.stopPreview();
    const command = this.previewSerial;
    await this.init();
    if (command !== this.previewSerial || !this.context || !this.master) return;
    const track: Track = {
      id: "preview",
      name: "Preview",
      type: pattern.kind === "drums" ? "drums" : "midi",
      color: "sage",
      instrument: {
        type: instrument,
        attack: 0.008,
        release: 0.25,
        brightness: 0.6,
      },
      mixer: { volume: 0.8, pan: 0, mute: false, solo: false },
      effects: { reverb: 0.12, delay: 0, filter: 14000 },
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
    const render = new OfflineAudioContext(
      2,
      Math.ceil(duration * EXPORT_SAMPLE_RATE),
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
    const buffer = await render.startRendering();
    if (command !== this.previewSerial || !this.context || !this.master) return;
    this.previewGraph = new TrackGraph(
      this.context,
      this.master,
      track,
      true,
      project.transport.bpm,
    );
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
    if (!this.context || !this.master) return;
    const buffer = this.assets.get(id);
    if (!buffer)
      throw new Error("This sample is not available locally. Import it again.");
    const voice = sample(
      this.context,
      this.master,
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
    const master = context.createGain();
    master.gain.value = project.masterVolume;
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.1;
    master.connect(limiter);
    limiter.connect(context.destination);
    const graphs = new Map<string, TrackGraph>();
    const tracks = new Map(project.tracks.map((track) => [track.id, track]));
    for (const track of project.tracks)
      graphs.set(
        track.id,
        new TrackGraph(
          context,
          master,
          track,
          isTrackAudible(project, track.id),
          project.transport.bpm,
        ),
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
      master.disconnect();
      limiter.disconnect();
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
    this.master?.disconnect();
    this.limiter?.disconnect();
    this.analyser?.disconnect();
    this.master = null;
    this.limiter = null;
    this.analyser = null;
    this.context = null;
    this.transport = null;
    this.project = null;
    this.structure = "";
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
    this.transport.bpm.value = project.transport.bpm;
    this.transport.timeSignature = project.transport.timeSignature;
    this.transport.loop = project.transport.loop;
    this.transport.loopStart = `${project.transport.loopStart}i`;
    this.transport.loopEnd = `${Math.max(project.transport.loopStart + PPQ, project.transport.loopEnd)}i`;
  }
  private syncGraphs(project: Project): void {
    if (!this.context || !this.master) return;
    this.master.gain.setTargetAtTime(
      Math.max(0, Math.min(1.5, project.masterVolume)),
      this.context.currentTime,
      0.012,
    );
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
          this.master,
          track,
          isTrackAudible(project, track.id),
          project.transport.bpm,
        );
        this.tracks.set(track.id, graph);
      } else
        graph.update(
          track,
          isTrackAudible(project, track.id),
          project.transport.bpm,
        );
    }
  }
  private schedulingSignature(project: Project): string {
    return JSON.stringify([
      project.id,
      project.transport,
      project.patterns,
      project.tracks.map((track) => [track.id, track.clips, track.instrument]),
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
