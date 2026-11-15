import { test, expect } from "@playwright/test";
import type { StudioAudioEngine } from "../src/audio/engine";
import type * as Factories from "../src/domain/factories";
import type { encodeWav } from "../src/audio/wav";

declare global {
  interface Window {
    audioTest: {
      engine: StudioAudioEngine;
      encodeWav: typeof encodeWav;
    } & typeof Factories;
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto("/e2e/fixture.html");
  await page.waitForFunction(() => !!window.audioTest);
});

test("renders the full demo as audible stereo PCM with the exact arrangement duration", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const result = await page.evaluate(async () => {
    const { engine, createDemoProject } = window.audioTest;
    const project = createDemoProject();
    const wave = await engine.exportWav(project);
    const buffer = await wave.arrayBuffer();
    const view = new DataView(buffer);
    let sum = 0,
      peak = 0,
      nonzero = 0;
    for (let offset = 44; offset < view.byteLength; offset += 2) {
      const sample = view.getInt16(offset, true) / 32768;
      sum += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
      if (sample) nonzero++;
    }
    return {
      riff: new TextDecoder().decode(buffer.slice(0, 4)),
      format: view.getUint16(20, true),
      channels: view.getUint16(22, true),
      rate: view.getUint32(24, true),
      bits: view.getUint16(34, true),
      duration: view.getUint32(40, true) / view.getUint32(28, true),
      rms: Math.sqrt(sum / ((view.byteLength - 44) / 2)),
      peak,
      nonzero,
      expected: (16 * 4 * 60) / project.transport.bpm + 2,
    };
  });
  expect(result.riff).toBe("RIFF");
  expect(result.format).toBe(1);
  expect(result.channels).toBe(2);
  expect(result.rate).toBe(44100);
  expect(result.bits).toBe(16);
  expect(result.duration).toBeCloseTo(result.expected, 4);
  expect(result.rms).toBeGreaterThan(0.005);
  expect(result.peak).toBeLessThanOrEqual(1);
  expect(result.nonzero).toBeGreaterThan(100000);
  expect(errors).toEqual([]);
  console.log("Validated demo WAV", result);
});

test("all-muted export is silent and tempo changes alter the rendered duration", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const {
      engine,
      createProject,
      createTrack,
      createPattern,
      createNote,
      createMidiClip,
    } = window.audioTest;
    const project = createProject();
    const track = createTrack("electric-piano");
    const pattern = createPattern("midi", 1920);
    pattern.notes = [createNote(60, 0, 960, 0.8)];
    track.clips = [createMidiClip(pattern)];
    project.tracks = [track];
    project.patterns = { [pattern.id]: pattern };
    project.transport.bpm = 90;
    track.mixer.mute = true;
    const muted = new DataView(
      await (await engine.exportWav(project)).arrayBuffer(),
    );
    let peak = 0;
    for (let offset = 44; offset < muted.byteLength; offset += 2)
      peak = Math.max(peak, Math.abs(muted.getInt16(offset, true)));
    track.mixer.mute = false;
    project.transport.bpm = 180;
    const faster = new DataView(
      await (await engine.exportWav(project)).arrayBuffer(),
    );
    return {
      peak,
      slow: muted.getUint32(40, true) / muted.getUint32(28, true),
      fast: faster.getUint32(40, true) / faster.getUint32(28, true),
    };
  });
  expect(result.peak).toBe(0);
  expect(result.slow).toBeCloseTo((4 * 60) / 90 + 2, 4);
  expect(result.fast).toBeCloseTo((4 * 60) / 180 + 2, 4);
});

test("decodes imported WAV and honors its audio clip position, trim, loop and gain", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { engine, encodeWav, createProject, createTrack } = window.audioTest;
    const data = new Float32Array(22050);
    for (let index = 0; index < data.length; index++)
      data[index] = Math.sin((index * 2 * Math.PI * 220) / 44100) * 0.4;
    await engine.loadAsset("test-asset", encodeWav([data], 44100));
    const project = createProject();
    project.transport.bpm = 120;
    const track = createTrack("audio");
    track.effects = { reverb: 0, delay: 0, filter: 18000 };
    track.clips = [
      {
        id: "audio-clip",
        type: "audio",
        name: "Imported tone",
        assetId: "test-asset",
        startTick: 1920,
        durationTicks: 1920,
        offsetSeconds: 0.1,
        loop: true,
        gain: 0.5,
      },
    ];
    project.tracks = [track];
    project.assets = [
      {
        id: "test-asset",
        name: "Test.wav",
        duration: 0.5,
        mimeType: "audio/wav",
        category: "One-shots",
      },
    ];
    const wave = new DataView(
      await (await engine.exportWav(project)).arrayBuffer(),
    );
    const rms = (start: number, end: number) => {
      let sum = 0,
        count = 0;
      for (
        let frame = Math.floor(start * 44100);
        frame < Math.floor(end * 44100);
        frame++
      ) {
        const sample = wave.getInt16(44 + frame * 4, true) / 32768;
        sum += sample * sample;
        count++;
      }
      return Math.sqrt(sum / count);
    };
    return {
      loaded: engine.hasAsset("test-asset"),
      before: rms(0.2, 1.8),
      during: rms(2.2, 3.8),
      after: rms(4.2, 5.8),
      duration: wave.getUint32(40, true) / wave.getUint32(28, true),
    };
  });
  expect(result.loaded).toBe(true);
  expect(result.before).toBe(0);
  expect(result.during).toBeGreaterThan(0.02);
  expect(result.after).toBeLessThan(0.0001);
  expect(result.duration).toBe(6);
});

test("real audio clock advances, outputs sound, pauses, seeks and survives rapid toggles", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "Activate audio" }).click();
  await page.evaluate(async () => {
    const { engine, createDemoProject } = window.audioTest;
    await engine.play(createDemoProject(), 0);
  });
  await page.waitForTimeout(600);
  const active = await page.evaluate(() => ({
    playing: window.audioTest.engine.isPlaying(),
    tick: window.audioTest.engine.getTick(),
    level: window.audioTest.engine.getLevel(),
  }));
  expect(active.playing).toBe(true);
  expect(active.tick).toBeGreaterThan(200);
  expect(active.level).toBeGreaterThan(0.001);
  const paused = await page.evaluate(() => {
    window.audioTest.engine.pause();
    return window.audioTest.engine.getTick();
  });
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.audioTest.engine.getTick())).toBe(
    paused,
  );
  await page.evaluate(async () => {
    const { engine, createDemoProject } = window.audioTest;
    const p = createDemoProject();
    engine.play(p);
    engine.pause();
    engine.play(p);
    engine.stop();
    await engine.play(p, 1920);
  });
  await page.waitForTimeout(250);
  const seek = await page.evaluate(() => ({
    playing: window.audioTest.engine.isPlaying(),
    tick: window.audioTest.engine.getTick(),
  }));
  expect(seek.playing).toBe(true);
  expect(seek.tick).toBeGreaterThan(1920);
  await page.evaluate(() => window.audioTest.engine.stop());
  await page.waitForTimeout(100);
  const stopped = await page.evaluate(() => ({
    playing: window.audioTest.engine.isPlaying(),
    tick: window.audioTest.engine.getTick(),
  }));
  expect(stopped).toEqual({ playing: false, tick: 0 });
  expect(errors).toEqual([]);
  console.log("Validated realtime audio", active, seek);
});

test("previews and loops an independent pattern using a native audio buffer clock", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Activate audio" }).click();
  await page.evaluate(async () => {
    const { engine, createProject, createPattern, createNote } =
      window.audioTest;
    const p = createProject();
    p.transport.bpm = 240;
    const pattern = createPattern("midi", 1920);
    pattern.notes = [createNote(60, 0, 1800, 0.8)];
    await engine.previewPattern(p, pattern, "synth-pad");
  });
  await page.waitForTimeout(1300);
  const state = await page.evaluate(() => ({
    preview: window.audioTest.engine.isPreviewing(),
    tick: window.audioTest.engine.getPreviewTick(),
    level: window.audioTest.engine.getLevel(),
    playing: window.audioTest.engine.isPlaying(),
  }));
  expect(state.preview).toBe(true);
  expect(state.playing).toBe(false);
  expect(state.tick).toBeGreaterThan(0);
  expect(state.tick).toBeLessThan(1920);
  expect(state.level).toBeGreaterThan(0.001);
  await page.evaluate(() => window.audioTest.engine.stopPreview());
  expect(
    await page.evaluate(() => window.audioTest.engine.isPreviewing()),
  ).toBe(false);
});
