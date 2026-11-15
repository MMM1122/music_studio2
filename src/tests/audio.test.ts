import { describe, expect, it } from "vitest";
import { BAR, PPQ, type Project, type Track } from "../domain/models";
import {
  collectEvents,
  eventsCrossingTick,
  isTrackAudible,
  arrangementEndTick,
  ticksToSeconds,
} from "../audio/scheduler";
import { encodeWav } from "../audio/wav";

const track = (id = "track"): Track => ({
  id,
  name: "Piano",
  type: "midi",
  color: "mauve",
  instrument: {
    type: "electric-piano",
    attack: 0.01,
    release: 0.2,
    brightness: 0.7,
  },
  effects: { reverb: 0.1, delay: 0, filter: 12000 },
  mixer: { volume: 0.8, pan: 0, mute: false, solo: false },
  clips: [
    {
      id: "clip",
      name: "Phrase",
      type: "midi",
      patternId: "pattern",
      startTick: BAR,
      durationTicks: BAR * 2,
      loop: true,
      gain: 0.7,
    },
  ],
});
const project = (): Project => ({
  schemaVersion: 1,
  id: "project",
  name: "Test",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  key: "C minor",
  transport: {
    bpm: 90,
    timeSignature: [4, 4],
    loop: true,
    loopStart: 0,
    loopEnd: BAR * 4,
  },
  masterVolume: 0.8,
  tracks: [track()],
  patterns: {
    pattern: {
      id: "pattern",
      name: "Phrase",
      lengthTicks: BAR,
      kind: "midi",
      swing: 0,
      notes: [
        {
          id: "note",
          pitch: 60,
          startTick: 0,
          durationTicks: PPQ,
          velocity: 0.8,
        },
      ],
    },
  },
  assets: [],
});

describe("audio scheduling", () => {
  it("expands shared patterns at their audible arrangement positions", () => {
    const events = collectEvents(project());
    expect(events.map((event) => event.startTick)).toEqual([BAR, BAR * 2]);
    expect(events.every((event) => event.gain === 0.7)).toBe(true);
  });
  it("moves playback when a clip is moved and plays non-looped patterns once", () => {
    const p = project();
    p.tracks[0].clips[0].startTick = BAR * 5;
    p.tracks[0].clips[0].loop = false;
    expect(collectEvents(p).map((event) => event.startTick)).toEqual([BAR * 5]);
  });
  it("clips long notes at both the source-pattern and clip boundary", () => {
    const p = project();
    p.patterns.pattern.notes[0] = {
      id: "n",
      pitch: 48,
      startTick: BAR - 120,
      durationTicks: PPQ,
      velocity: 0.8,
    };
    p.tracks[0].clips[0].durationTicks = BAR + BAR - 60;
    const events = collectEvents(p);
    expect(events.map((event) => event.durationTicks)).toEqual([120, 60]);
  });
  it("swings offbeat sixteenths without altering saved note positions", () => {
    const p = project();
    p.patterns.pattern.notes[0].startTick = 120;
    p.patterns.pattern.swing = 0.5;
    expect(collectEvents(p)[0].startTick).toBe(BAR + 150);
    expect(p.patterns.pattern.notes[0].startTick).toBe(120);
  });
  it("resumes events crossing a seek without duplicating events starting exactly there", () => {
    const events = collectEvents(project());
    expect(eventsCrossingTick(events, BAR)).toEqual([]);
    expect(eventsCrossingTick(events, BAR + 120)).toEqual([events[0]]);
  });
  it("retains audio trim, gain and loop instructions", () => {
    const p = project();
    p.tracks[0].clips = [
      {
        type: "audio",
        id: "a",
        name: "Sample",
        assetId: "asset",
        startTick: 480,
        durationTicks: 1920,
        offsetSeconds: 0.25,
        loop: true,
        gain: 0.5,
      },
    ];
    expect(collectEvents(p)[0]).toMatchObject({
      type: "audio",
      offsetSeconds: 0.25,
      loop: true,
      startTick: 480,
      gain: 0.5,
    });
  });
  it("honors mute and global solo independently of scheduling", () => {
    const p = project();
    p.tracks.push(track("second"));
    p.tracks[0].mixer.solo = true;
    expect(isTrackAudible(p, "track")).toBe(true);
    expect(isTrackAudible(p, "second")).toBe(false);
    p.tracks[0].mixer.mute = true;
    expect(isTrackAudible(p, "track")).toBe(false);
  });
  it("uses the full arrangement extent, not the transport loop, for export", () => {
    const p = project();
    p.transport.loopEnd = BAR;
    expect(arrangementEndTick(p)).toBe(BAR * 3);
    expect(ticksToSeconds(BAR * 3, 90)).toBe(8);
  });
});

describe("PCM WAV encoder", () => {
  it("encodes a standard RIFF stereo header, duration and non-silent samples", () => {
    const pcm = new Float32Array(44100);
    for (let i = 0; i < pcm.length; i++)
      pcm[i] = Math.sin((i * 2 * Math.PI * 440) / 44100) * 0.5;
    const encoded = encodeWav([pcm, pcm], 44100);
    const view = new DataView(encoded);
    expect(new TextDecoder().decode(encoded.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(encoded.slice(8, 12))).toBe("WAVE");
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true) / view.getUint32(28, true)).toBe(1);
    expect(view.getInt16(48, true)).toBeGreaterThan(0);
    expect(encoded.byteLength).toBe(44 + 44100 * 4);
  });
  it("clamps out-of-range samples and sanitizes non-finite input", () => {
    const view = new DataView(
      encodeWav([Float32Array.from([-2, 2, NaN, Infinity])], 44100),
    );
    expect(
      [0, 1, 2, 3].map((index) => view.getInt16(44 + index * 2, true)),
    ).toEqual([-32768, 32767, 0, 0]);
  });
  it("rejects inconsistent channel lengths", () => {
    expect(() =>
      encodeWav([new Float32Array(2), new Float32Array(3)], 44100),
    ).toThrow("equal length");
  });
});
