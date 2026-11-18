import { test, expect } from "@playwright/test";
test("reference playback follows source time on seek/pause/restart and honors A/B and mute/solo", async ({
  page,
}) => {
  await page.goto("/e2e/fixture.html");
  await page.waitForFunction("!!window.audioTest");
  await page.getByRole("button", { name: "Activate audio" }).click();
  const result = await page.evaluate(async () => {
    const {
      engine,
      encodeWav,
      createProject,
      createTrack,
      createPattern,
      createNote,
      createMidiClip,
    } = window.audioTest;
    const { createReferenceTrack, rescaleReferenceClips } = await import(
      "/src/domain/reference.ts"
    );
    const { secondsToTicks } = await import("/src/domain/timing.ts");
    const pcm = Float32Array.from(
      { length: 16000 * 8 },
      (_, i) =>
        0.3 *
        Math.sin(
          (2 * Math.PI * (220 * (Math.floor(i / 32000) + 1)) * i) / 16000,
        ),
    );
    const buffer = await engine.loadAsset(
      "reference-test",
      encodeWav([pcm], 16000),
    );
    const p = createProject();
    p.transport.bpm = 120;
    p.transport.loop = false;
    const ref = createReferenceTrack(
      {
        id: "reference-test",
        name: "Synthetic reference",
        duration: buffer.duration,
        mimeType: "audio/wav",
        category: "Reference",
      },
      120,
    );
    const track = createTrack("electric-piano"),
      pattern = createPattern("midi", 7680);
    pattern.notes = [createNote(60, 0, 7500)];
    track.clips = [createMidiClip(pattern)];
    p.tracks = [ref, track];
    p.patterns = { [pattern.id]: pattern };
    engine.update(p);
    await engine.play(p, secondsToTicks(2.3, 120));
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    await wait(250);
    function peak() {
      const values = new Float32Array(1024);
      const info = engine.readTrackSpectrum(ref.id, values);
      let at = 0;
      for (let i = 1; i < values.length; i++)
        if (values[i] > values[at]) at = i;
      return {
        hz: info ? (at * info.sampleRate) / info.fftSize : 0,
        db: values[at],
      };
    }
    peak();
    await wait(140);
    const sought = peak();
    engine.pause();
    const paused = engine.getTick();
    await wait(100);
    const stayed = engine.getTick();
    await engine.play(p);
    await wait(200);
    const restarted = engine.getTick();
    engine.setReferenceMode("composition");
    await wait(300);
    const excluded = peak(),
      compositionLevel = engine.getLevel();
    ref.mixer.solo = true;
    const soloed = structuredClone(p);
    engine.update(soloed);
    await wait(100);
    const compositionWithReferenceSolo = engine.getLevel();
    engine.setReferenceMode("reference");
    await wait(200);
    const included = peak();
    const muted = structuredClone(soloed);
    muted.tracks[0].mixer.mute = true;
    engine.update(muted);
    await wait(300);
    const mutedPeak = peak();
    engine.setReferenceMode("both");
    const changed = structuredClone(p);
    changed.tracks[0].mixer.solo = false;
    changed.transport.bpm = 60;
    rescaleReferenceClips(changed, 120);
    engine.update(changed);
    await wait(100);
    engine.seek(secondsToTicks(4.4, 60));
    await wait(200);
    const afterTempo = peak();

    engine.stop();
    return {
      sought,
      paused,
      stayed,
      restarted,
      excluded,
      compositionLevel,
      compositionWithReferenceSolo,
      included,
      mutedPeak,
      afterTempo,
      duration: changed.tracks[0].clips[0].durationTicks / 480,
    };
  });
  console.log("Reference synchronization", {
    sought: result.sought,
    paused: result.paused,
    restarted: result.restarted,
    afterTempo: result.afterTempo,
  });
  expect(result.sought.hz).toBeGreaterThan(410);
  expect(result.sought.hz).toBeLessThan(470);
  expect(result.stayed).toBeCloseTo(result.paused, 1);
  expect(result.restarted).toBeGreaterThan(result.paused);
  expect(result.restarted).toBeLessThan(result.paused + 400);
  expect(result.excluded.db).toBeLessThan(-80);
  expect(result.compositionLevel).toBeGreaterThan(0.001);
  expect(result.compositionWithReferenceSolo).toBeGreaterThan(0.001);
  expect(result.included.db).toBeGreaterThan(-40);
  expect(result.mutedPeak.db).toBeLessThan(-80);
  expect(result.afterTempo.hz).toBeGreaterThan(630);
  expect(result.afterTempo.hz).toBeLessThan(690);
  expect(result.duration).toBe(8);
});
test("WAV excludes reference bytes, length and solo state while preserving ordinary audio export", async ({
  page,
}) => {
  await page.goto("/e2e/fixture.html");
  await page.waitForFunction("!!window.audioTest");
  const result = await page.evaluate(async () => {
    const { engine, encodeWav, createProject, createTrack } = window.audioTest;
    const { createReferenceTrack } = await import("/src/domain/reference.ts");
    const wave = encodeWav(
      [
        Float32Array.from(
          { length: 16000 },
          (_, i) => 0.3 * Math.sin((i * 2 * Math.PI * 440) / 16000),
        ),
      ],
      16000,
    );
    await engine.loadAsset("ordinary-test", wave);
    const p = createProject();
    p.transport.bpm = 120;
    p.transport.loop = false;
    const t = createTrack("audio");
    t.effects = { reverb: 0, delay: 0, filter: 20000 };
    t.clips = [
      {
        id: "ordinary-clip",
        name: "Own recording",
        type: "audio",
        assetId: "ordinary-test",
        startTick: 0,
        durationTicks: 960,
        offsetSeconds: 0,
        loop: false,
        gain: 1,
      },
    ];
    p.tracks = [t];
    const baseline = new Uint8Array(
      await (await engine.exportWav(p)).arrayBuffer(),
    );
    const ref = createReferenceTrack(
      {
        id: "missing-reference",
        name: "Not decoded reference",
        duration: 120,
        mimeType: "audio/wav",
        category: "Reference",
      },
      120,
    );
    ref.mixer.solo = true;
    p.tracks.unshift(ref);
    engine.setReferenceMode("reference");
    const withRef = new Uint8Array(
      await (await engine.exportWav(p)).arrayBuffer(),
    );
    let equal = baseline.length === withRef.length;
    for (let i = 0; i < baseline.length && equal; i++)
      if (baseline[i] !== withRef[i]) equal = false;
    const view = new DataView(withRef.buffer);
    let peak = 0;
    for (let i = 44; i < view.byteLength; i += 2)
      peak = Math.max(peak, Math.abs(view.getInt16(i, true)));
    return {
      equal,
      peak,
      seconds: view.getUint32(40, true) / view.getUint32(28, true),
    };
  });
  expect(result.equal).toBe(true);
  expect(result.peak).toBeGreaterThan(100);
  expect(result.seconds).toBeCloseTo(4, 3);
});
