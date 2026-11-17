import {
  BAR,
  PPQ,
  type InstrumentType,
  type MidiNote,
  type Project,
} from "../domain/models";
import {
  createMidiClip,
  createNote,
  createPattern,
  createProject,
  createTrack,
} from "../domain/factories";
import { validateProject } from "../domain/validation";
import {
  collectEvents,
  isTrackAudible,
  type NoteEvent,
} from "../audio/scheduler";

/** Bounded Standard MIDI File 0/1 support (MIDI Association SMF specification).
 * Files are data only: SysEx is skipped, never sent to a device. */
export const MAX_MIDI_BYTES = 10 * 1024 * 1024;
const MAX_NOTES = 50_000;
const MAX_EVENTS = 250_000;
const MAX_TICKS = BAR * 4096;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const melodicChannels = Array.from({ length: 16 }, (_, i) => i).filter(
  (i) => i !== 9,
);

export interface MidiImportResult {
  project: Project;
  warnings: string[];
}
class Reader {
  at = 0;
  constructor(
    readonly data: Uint8Array,
    readonly end = data.length,
  ) {}
  require(count: number) {
    if (!Number.isInteger(count) || count < 0 || this.at + count > this.end)
      throw new Error("Truncated MIDI file.");
  }
  byte() {
    this.require(1);
    return this.data[this.at++];
  }
  u16() {
    return this.byte() * 256 + this.byte();
  }
  u32() {
    return (
      this.byte() * 16777216 +
      this.byte() * 65536 +
      this.byte() * 256 +
      this.byte()
    );
  }
  text(count: number) {
    return decoder.decode(this.take(count));
  }
  take(count: number) {
    this.require(count);
    const out = this.data.subarray(this.at, this.at + count);
    this.at += count;
    return out;
  }
  variable() {
    let value = 0;
    for (let i = 0; i < 4; i++) {
      const byte = this.byte();
      value = value * 128 + (byte & 127);
      if (!(byte & 128)) return value;
    }
    throw new Error("Invalid MIDI variable-length integer.");
  }
  dataByte() {
    const value = this.byte();
    if (value > 127) throw new Error("Invalid MIDI channel-event data.");
    return value;
  }
}
interface Pending {
  pitch: number;
  start: number;
  velocity: number;
}
interface Group {
  channel: number;
  sourceTrack: number;
  program: number;
  notes: MidiNote[];
  active: Map<number, Pending[]>;
  sustained: Pending[];
  sustain: boolean;
}
function instrumentFor(program: number, channel: number): InstrumentType {
  if (channel === 9) return "drum-kit";
  if (program >= 32 && program <= 39) return "synth-bass";
  if (program >= 80 && program <= 87) return "lead-synth";
  if (program >= 88 && program <= 95) return "synth-pad";
  if ((program >= 24 && program <= 31) || (program >= 8 && program <= 15))
    return "pluck";
  if (program <= 3) return "felt-piano";
  return "electric-piano";
}
const programFor: Record<InstrumentType, number> = {
  "electric-piano": 4,
  "felt-piano": 0,
  "synth-bass": 38,
  "sub-bass": 38,
  "synth-pad": 89,
  "lead-synth": 80,
  pluck: 10,
  "drum-kit": 0,
  fourier: 80,
};

/** Returns warnings alongside the fresh project so lossy MIDI features are visible. */
export function readMidi(
  data: ArrayBuffer,
  name = "Imported MIDI",
): MidiImportResult {
  if (data.byteLength > MAX_MIDI_BYTES)
    throw new Error("MIDI import is limited to 10 MB.");
  const reader = new Reader(new Uint8Array(data));
  if (reader.text(4) !== "MThd")
    throw new Error("This is not a Standard MIDI file.");
  const headerLength = reader.u32();
  if (headerLength < 6) throw new Error("Invalid MIDI header length.");
  reader.require(headerLength);
  const format = reader.u16(),
    trackCount = reader.u16(),
    division = reader.u16();
  if (format !== 0 && format !== 1)
    throw new Error(
      "Only MIDI format 0 and 1 files are supported; format 2 uses independent sequences.",
    );
  if (!trackCount || trackCount > 129 || (format === 0 && trackCount !== 1))
    throw new Error(
      "Invalid MIDI track count (maximum 129 including the conductor).",
    );
  if (division & 0x8000)
    throw new Error(
      "SMPTE-timed MIDI is not supported. Export with musical PPQN timing.",
    );
  if (!division)
    throw new Error("MIDI ticks per quarter note must be positive.");
  reader.take(headerLength - 6);
  const warnings = new Set<string>();
  const names: string[] = [];
  const groups: Group[] = [];
  const tempos: { tick: number; value: number }[] = [];
  let eventCount = 0,
    noteCount = 0,
    noteStarts = 0,
    latestTick = 0;
  const convert = (tick: number) => {
    const value = Math.round((tick * PPQ) / division);
    if (!Number.isSafeInteger(value) || value > MAX_TICKS)
      throw new Error("MIDI arrangement exceeds 4096 bars.");
    return value;
  };
  const finish = (group: Group, pending: Pending, at: number) => {
    const start = convert(pending.start),
      end = Math.max(start + 1, convert(at));
    if (end > MAX_TICKS) throw new Error("MIDI arrangement exceeds 4096 bars.");
    group.notes.push(
      createNote(pending.pitch, start, end - start, pending.velocity / 127),
    );
    if (++noteCount > MAX_NOTES)
      throw new Error("MIDI import is limited to 50,000 notes.");
  };
  for (let trackIndex = 0; trackIndex < trackCount; trackIndex++) {
    if (reader.text(4) !== "MTrk") throw new Error("Missing MIDI track chunk.");
    const length = reader.u32();
    const stream = new Reader(reader.take(length));
    const byChannel = new Map<number, Group>();
    const programs = new Map<number, number>();
    let tick = 0,
      running = 0,
      ended = false;
    const getGroup = (channel: number) => {
      let group = byChannel.get(channel);
      if (!group) {
        group = {
          channel,
          sourceTrack: trackIndex,
          program: programs.get(channel) ?? 0,
          notes: [],
          active: new Map(),
          sustained: [],
          sustain: false,
        };
        byChannel.set(channel, group);
        groups.push(group);
        if (groups.length > 128)
          throw new Error(
            "MIDI channels expand into more than 128 Studio tracks.",
          );
      }
      return group;
    };
    while (stream.at < stream.end) {
      if (++eventCount > MAX_EVENTS)
        throw new Error("MIDI file has too many events.");
      tick += stream.variable();
      convert(tick);
      latestTick = Math.max(latestTick, tick);
      let status = stream.byte();
      if (status < 128) {
        if (!running)
          throw new Error(
            "MIDI running status has no preceding channel event.",
          );
        stream.at--;
        status = running;
      } else if (status < 0xf0) running = status;
      else running = 0;
      if (status === 0xff) {
        const type = stream.byte(),
          size = stream.variable();
        const payload = stream.take(size);
        if (type === 0x2f) {
          if (size) throw new Error("Invalid MIDI end-of-track event.");
          ended = true;
          break;
        }
        if (type === 0x03)
          names[trackIndex] = decoder
            .decode(payload.subarray(0, 1200))
            .replace(/[\u0000-\u001f]/g, "")
            .slice(0, 280);
        if (type === 0x51) {
          if (size !== 3) throw new Error("Invalid MIDI tempo event.");
          const value = payload[0] * 65536 + payload[1] * 256 + payload[2];
          if (!value) throw new Error("Invalid zero MIDI tempo.");
          tempos.push({ tick, value });
        }
        if (type === 0x58 && (size < 4 || payload[0] !== 4 || payload[1] !== 2))
          warnings.add(
            "Time-signature changes are shown on Studio’s 4/4 grid; quarter-note timing is retained.",
          );
        continue;
      }
      if (status === 0xf0 || status === 0xf7) {
        stream.take(stream.variable());
        warnings.add("SysEx device settings were omitted.");
        continue;
      }
      if (status >= 0xf0) throw new Error("Unsupported MIDI system event.");
      const channel = status & 15,
        command = status >> 4;
      const first = stream.dataByte(),
        second = command === 0xc || command === 0xd ? 0 : stream.dataByte();
      if (command === 0xc) {
        const group = byChannel.get(channel);
        if (
          group &&
          !group.notes.length &&
          ![...group.active.values()].some((notes) => notes.length) &&
          !group.sustained.length
        )
          group.program = first;
        else if (group && group.program !== first)
          warnings.add(
            "Program changes within a track use its first instrument; sounds are Studio approximations.",
          );
        programs.set(channel, first);
        continue;
      }
      if (command === 9 && second > 0) {
        if (++noteStarts > MAX_NOTES)
          throw new Error("MIDI import is limited to 50,000 notes.");
        const group = getGroup(channel),
          pending = { pitch: first, start: tick, velocity: second };
        const queue = group.active.get(first) ?? [];
        queue.push(pending);
        group.active.set(first, queue);
        continue;
      }
      if (command === 8 || (command === 9 && second === 0)) {
        const group = byChannel.get(channel),
          queue = group?.active.get(first),
          pending = queue?.shift();
        if (group && pending) {
          if (group.sustain) group.sustained.push(pending);
          else finish(group, pending, tick);
        }
        continue;
      }
      if (command === 0xb && first === 64) {
        const group = getGroup(channel),
          down = second >= 64;
        if (group.sustain && !down) {
          group.sustained.forEach((note) => finish(group, note, tick));
          group.sustained = [];
        }
        group.sustain = down;
        continue;
      }
      if (command === 0xb && (first === 120 || first === 123)) {
        const group = byChannel.get(channel);
        if (group) {
          group.active.forEach((queue) =>
            queue.forEach((note) => {
              if (first === 123 && group.sustain) group.sustained.push(note);
              else finish(group, note, tick);
            }),
          );
          group.active.clear();
          if (first === 120 || !group.sustain) {
            group.sustained.forEach((note) => finish(group, note, tick));
            group.sustained = [];
          }
        }
        continue;
      }
      if (
        command === 0xb ||
        command === 0xa ||
        command === 0xd ||
        command === 0xe
      )
        warnings.add(
          "Pitch bend, pressure and controllers other than sustain/all-notes-off were omitted.",
        );
    }
    if (!ended) throw new Error("Missing MIDI end-of-track event.");
    if (stream.at !== stream.end)
      throw new Error("Unexpected bytes after the MIDI end-of-track event.");
    for (const group of byChannel.values()) {
      const unfinished = [...group.active.values()].flat();
      if (unfinished.length || group.sustained.length)
        warnings.add(
          "Unreleased notes were closed at the end of their source track.",
        );
      for (const note of [...unfinished, ...group.sustained])
        finish(group, note, Math.max(tick, note.start + division / 4));
    }
  }
  if (reader.at !== reader.end)
    throw new Error("Unexpected trailing data after MIDI tracks.");
  const project = createProject(
    name
      .replace(/\.midi?$/i, "")
      .trim()
      .slice(0, 300) || "Imported MIDI",
  );
  tempos.sort((a, b) => a.tick - b.tick);
  const firstTempo = tempos[0]?.value ?? 500000;
  const bpm = 60000000 / firstTempo;
  if (bpm < 30 || bpm > 300)
    throw new Error("This MIDI tempo is outside Studio’s 30–300 BPM range.");
  project.transport.bpm = Math.round(bpm * 1000) / 1000;
  if (tempos.some((t) => t.value !== firstTempo))
    warnings.add(
      "Studio uses a fixed tempo: only the first MIDI tempo was kept.",
    );
  if (tempos[0]?.tick > 0)
    warnings.add(
      "The first MIDI tempo was applied from the start of the session.",
    );
  project.key = "C major";
  project.transport.loop = false;
  let end = Math.max(BAR, convert(latestTick));
  for (const group of groups.filter((group) => group.notes.length)) {
    const track = createTrack(instrumentFor(group.program, group.channel));
    track.name =
      `${names[group.sourceTrack] || `MIDI track ${group.sourceTrack + 1}`} · Ch ${group.channel + 1}`.slice(
        0,
        300,
      );
    const last = Math.max(
      ...group.notes.map((note) => note.startTick + note.durationTicks),
    );
    const length = Math.ceil(last / BAR) * BAR;
    const pattern = createPattern(
      group.channel === 9 ? "drums" : "midi",
      length,
    );
    pattern.name = track.name;
    pattern.notes = group.notes.sort(
      (a, b) => a.startTick - b.startTick || a.pitch - b.pitch,
    );
    const clip = createMidiClip(pattern);
    clip.loop = false;
    track.clips = [clip];
    project.patterns[pattern.id] = pattern;
    project.tracks.push(track);
    end = Math.max(end, length);
  }
  if (!project.tracks.length)
    throw new Error("This MIDI file contains no playable notes.");
  project.transport.loopEnd = Math.ceil(end / BAR) * BAR;
  return { project: validateProject(project), warnings: [...warnings] };
}
export function importMidi(data: ArrayBuffer, name?: string): Project {
  return readMidi(data, name).project;
}

class Writer {
  bytes: number[] = [];
  byte(...values: number[]) {
    this.bytes.push(...values);
  }
  variable(value: number) {
    if (!Number.isInteger(value) || value < 0 || value > 0x0fffffff)
      throw new Error("MIDI delta time is out of range.");
    const bytes = [value & 127];
    while ((value = Math.floor(value / 128)))
      bytes.unshift((value & 127) | 128);
    this.byte(...bytes);
  }
  meta(type: number, payload: Uint8Array) {
    this.byte(0xff, type);
    this.variable(payload.length);
    for (const byte of payload) this.byte(byte);
  }
  finish() {
    this.variable(0);
    this.meta(0x2f, new Uint8Array());
    return new Uint8Array(this.bytes);
  }
}
function concat(parts: Uint8Array[]) {
  const result = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0),
  );
  let at = 0;
  for (const part of parts) {
    result.set(part, at);
    at += part.length;
  }
  return result;
}
function u32(value: number) {
  return new Uint8Array([
    value >>> 24,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ]);
}
function chunk(kind: string, bytes: Uint8Array) {
  return concat([encoder.encode(kind), u32(bytes.length), bytes]);
}

/** Type 1 MIDI with an explicit fixed-tempo conductor track. Audio tracks, effects,
 * custom timbres and automation are not representable here. */
export function exportMidi(input: Project): Uint8Array {
  const project = validateProject(input);
  const tracks = project.tracks.filter(
    (track) => track.type !== "audio" && isTrackAudible(project, track.id),
  );
  let estimate = 0;
  for (const track of tracks)
    for (const clip of track.clips)
      if (clip.type === "midi") {
        const pattern = project.patterns[clip.patternId];
        estimate +=
          pattern.notes.length *
          (clip.loop ? Math.ceil(clip.durationTicks / pattern.lengthTicks) : 1);
        if (estimate > MAX_NOTES)
          throw new Error("MIDI export is limited to 50,000 expanded notes.");
      }
  const notes = collectEvents({ ...project, tracks }).filter(
    (event): event is NoteEvent =>
      event.type === "note" && event.velocity > 0 && event.gain > 0,
  );
  if (!notes.length)
    throw new Error("There are no audible MIDI notes to export.");
  const usedTracks = new Set(notes.map((note) => note.trackId));
  if (
    tracks.filter((track) => track.type !== "drums" && usedTracks.has(track.id))
      .length > 15
  )
    throw new Error(
      "MIDI export supports 15 melodic channels plus drums. Solo fewer tracks before exporting.",
    );
  const conductor = new Writer();
  conductor.variable(0);
  conductor.meta(0x03, encoder.encode(project.name));
  const tempo = Math.round(60000000 / project.transport.bpm);
  conductor.variable(0);
  conductor.meta(
    0x51,
    new Uint8Array([tempo >>> 16, (tempo >>> 8) & 255, tempo & 255]),
  );
  conductor.variable(0);
  conductor.meta(0x58, new Uint8Array([4, 2, 24, 8]));
  const chunks = [chunk("MTrk", conductor.finish())];
  let melodicIndex = 0;
  for (const track of tracks) {
    const events = notes.filter((note) => note.trackId === track.id);
    if (!events.length) continue;
    const channel =
      track.type === "drums" ? 9 : melodicChannels[melodicIndex++];
    const writer = new Writer();
    writer.variable(0);
    writer.meta(0x03, encoder.encode(track.name));
    writer.variable(0);
    writer.byte(0xc0 | channel, programFor[track.instrument.type]);
    const messages = events
      .flatMap((event) => [
        {
          tick: Math.round(event.startTick),
          order: 1,
          bytes: [
            0x90 | channel,
            event.pitch,
            Math.max(
              1,
              Math.min(127, Math.round(event.velocity * event.gain * 127)),
            ),
          ],
        },
        {
          tick: Math.round(event.startTick + event.durationTicks),
          order: 0,
          bytes: [0x80 | channel, event.pitch, 0],
        },
      ])
      .sort((a, b) => a.tick - b.tick || a.order - b.order);
    let tick = 0;
    for (const event of messages) {
      writer.variable(event.tick - tick);
      writer.byte(...event.bytes);
      tick = event.tick;
    }
    chunks.push(chunk("MTrk", writer.finish()));
  }
  const count = chunks.length;
  return concat([
    chunk(
      "MThd",
      new Uint8Array([0, 1, count >>> 8, count & 255, PPQ >>> 8, PPQ & 255]),
    ),
    ...chunks,
  ]);
}
