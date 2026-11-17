import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
const lab = (page: Page) => page.evaluate("window.__studioTest.getLab()");
const audio = (page: Page) =>
  page.evaluate("window.__studioTest.getAudioState()");
const project = (page: Page) =>
  page.evaluate("window.__studioTest.getProject()");
async function boot(page: Page) {
  await page.goto("/");
  await page.waitForFunction("!!window.__studioTest");
}
test("dragging a curve updates notes while its real audio clock and visualization continue", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1100 });
  await boot(page);
  await page.getByRole("button", { name: "Math Lab", exact: true }).click();
  const art = page.getByLabel("Live audio visualization");
  await expect(art).toHaveAttribute("data-signal", "silent");
  const before = await lab(page);
  const point = page.getByRole("slider", {
    name: "Curve point 5",
    exact: true,
  });
  const box = await point.boundingBox();
  if (!box) throw Error("Missing curve");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 90, {
    steps: 8,
  });
  await page.mouse.up();
  await expect.poll(async () => (await audio(page)).live).toBe(true);
  await expect
    .poll(async () => (await audio(page)).level)
    .toBeGreaterThan(0.001);
  expect((await lab(page)).functionPattern.notes[4].pitch).not.toBe(
    before.functionPattern.notes[4].pitch,
  );
  await art.scrollIntoViewIfNeeded();
  await expect(art).toHaveAttribute("data-signal", "active");
  const path = art.locator("path").nth(7),
    d = await path.getAttribute("d");
  await expect.poll(() => path.getAttribute("d")).not.toBe(d);
  const times = await page.evaluate(async () => {
    const hook = (window as any).__studioTest;
    const store = await import("/src/stores/mathLabStore.ts");
    const start = hook.getAudioState().previewTick;
    const values = [start];
    for (let i = 0; i < 8; i++) {
      const state = store.useMathLabStore.getState();
      const pattern = structuredClone(state.functionPattern);
      pattern.notes[12].pitch = i % 2 ? 62 : 74;
      state.patch({ functionPattern: pattern });
      await new Promise((r) => setTimeout(r, 70));
      values.push(hook.getAudioState().previewTick);
    }
    return values;
  });
  for (let i = 1; i < times.length; i++)
    expect((times[i] - times[i - 1] + 3840) % 3840).toBeLessThan(250);
  await page.getByRole("button", { name: "Stop shaping", exact: true }).click();
  await expect.poll(async () => (await audio(page)).live).toBe(false);
  await expect(art).toHaveAttribute("data-signal", "silent");
  await page.screenshot({ path: "docs/screenshots/creative-curve-light.png" });
  await page.getByLabel("Switch to dark theme").click();
  await page.waitForTimeout(200); // Wait for the theme transition before the screenshot.
  await page.screenshot({ path: "docs/screenshots/creative-curve-dark.png" });
  await page.setViewportSize({ width: 1280, height: 850 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.reload();
  await expect(
    page.getByRole("slider", { name: "Curve point 5", exact: true }),
  ).toHaveAttribute(
    "aria-valuenow",
    String(Math.round((await lab(page)).functionCurve[4] * 100)),
  );
  expect(errors).toEqual([]);
});
test("three-step flow keeps a curve, applies its Fourier sound, and seeds an ending without training", async ({
  page,
}) => {
  await boot(page);
  await page.getByRole("button", { name: "Math Lab", exact: true }).click();
  await page
    .getByRole("slider", { name: "Curve point 3", exact: true })
    .focus();
  await page.keyboard.press("Home");
  const curve = (await lab(page)).functionPattern;
  await page.getByRole("button", { name: /2 Choose a sound/ }).click();
  await page.getByLabel("Fourier preset").selectOption("Warm Soul Keys");
  await page
    .getByRole("button", { name: "Use this sound for my curve" })
    .click();
  expect((await lab(page)).sound).toBe("fourier");
  expect((await lab(page)).functionPattern).toEqual(curve);
  await page
    .getByRole("button", { name: "Continue this curve with probability" })
    .click();
  const state = await lab(page);
  expect(state.bayesPattern.notes).toEqual(curve.notes.slice(0, 8));
  expect(state.bayesModel).toEqual({});
  await page
    .getByRole("button", { name: "Suggest next note", exact: true })
    .click();
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  expect((await lab(page)).bayesPattern.notes).toHaveLength(9);
  await page
    .getByRole("button", { name: "Add to Studio", exact: true })
    .click();
  const p = await project(page);
  expect(p.tracks.at(-1).instrument.type).toBe("fourier");
  await page.getByLabel("Play", { exact: true }).click();
  await expect.poll(async () => (await audio(page)).playing).toBe(true);
  await expect
    .poll(async () => (await audio(page)).level)
    .toBeGreaterThan(0.001);
  await page.getByLabel("Stop", { exact: true }).click();
});
test("complete backup brings imported audio into a fresh browser and MIDI downloads reopen", async ({
  page,
  browser,
}) => {
  await boot(page);
  await page.getByRole("button", { name: "Samples", exact: true }).click();
  await page
    .locator("input[type=file]")
    .setInputFiles("public/samples/felt-kick.wav");
  await expect(page.locator(".toast")).toContainText(
    "added to the arrangement",
  );
  await page.getByTitle("Close dialog").click();
  const original = await project(page);
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export complete project", exact: true })
    .click();
  const download = await pending,
    file = await download.path();
  if (!file) throw Error("No backup");
  const context = await browser.newContext(),
    fresh = await context.newPage();
  await boot(fresh);
  await fresh.getByRole("button", { name: "Projects", exact: true }).click();
  await fresh.getByLabel("Complete project backup file").setInputFiles({
    name: "roundtrip.studio",
    mimeType: "application/octet-stream",
    buffer: await readFile(file),
  });
  await expect(fresh.getByLabel("Project title")).toHaveValue(
    `${original.name} (restored)`,
  );
  const restored = await project(fresh);
  expect(restored.id).not.toBe(original.id);
  expect(restored.assets[0].id).not.toBe(original.assets[0].id);
  await expect
    .poll(() =>
      fresh.evaluate(
        (id) => window.__studioTest.hasAsset(id),
        restored.assets[0].id,
      ),
    )
    .toBe(true);
  const bytes = await fresh.evaluate(async (id) => {
    const { getAsset } = await import("/src/persistence/database.ts");
    return [...new Uint8Array(await (await getAsset(id))!.arrayBuffer())];
  }, restored.assets[0].id);
  expect(Buffer.from(bytes)).toEqual(
    await readFile("public/samples/felt-kick.wav"),
  );
  await fresh.getByRole("button", { name: "Projects", exact: true }).click();
  const midipending = fresh.waitForEvent("download");
  await fresh.getByRole("button", { name: "Export MIDI", exact: true }).click();
  const midifile = await (await midipending).path();
  if (!midifile) throw Error("No MIDI");
  await fresh.getByLabel("MIDI file", { exact: true }).setInputFiles({
    name: "roundtrip.mid",
    mimeType: "audio/midi",
    buffer: await readFile(midifile),
  });
  await expect(fresh.getByLabel("Project title")).toHaveValue("roundtrip");
  expect((await project(fresh)).tracks.length).toBe(5);
  await context.close();
});
test("live preview cannot leak after cancelled activation and restores Studio tempo and loop", async ({
  page,
}) => {
  await page.goto("/e2e/fixture.html");
  await page.waitForFunction("!!window.audioTest");
  await page.getByRole("button", { name: "Activate audio" }).click();
  const result = await page.evaluate(async () => {
    const {
      engine,
      createProject,
      createPattern,
      createTrack,
      createNote,
      createMidiClip,
    } = window.audioTest;
    const p = createProject();
    p.transport.bpm = 180;
    p.transport.loop = false;
    const track = createTrack("electric-piano"),
      pattern = createPattern("midi", 1920);
    pattern.notes = [createNote(60, 0, 1800)];
    track.clips = [createMidiClip(pattern)];
    p.tracks = [track];
    p.patterns = { [pattern.id]: pattern };
    const originalInit = engine.init.bind(engine);
    engine.init = async () => {
      await new Promise((r) => setTimeout(r, 100));
      await originalInit();
    };
    const pending = engine.previewLivePattern(p, pattern, track.instrument);
    engine.stopPreview();
    await pending;
    const cancelled = !engine.isPreviewing();
    engine.init = originalInit;
    await engine.previewLivePattern(
      { ...p, transport: { ...p.transport, bpm: 60 } },
      pattern,
      track.instrument,
    );
    await new Promise((r) => setTimeout(r, 200));
    engine.update(p); // A Studio toolbar edit must not take over the Lab clock.
    const previewA = engine.getPreviewTick();
    await new Promise((r) => setTimeout(r, 300));
    const previewSpeed = engine.getPreviewTick() - previewA;
    engine.stopPreview();
    await engine.play(p);
    await new Promise((r) => setTimeout(r, 300));
    const a = engine.getTick();
    await new Promise((r) => setTimeout(r, 300));
    const b = engine.getTick();
    await new Promise((r) => setTimeout(r, 1000));
    const stopped = !engine.isPlaying();
    engine.stop();
    return { cancelled, previewSpeed, speed: b - a, stopped };
  });
  expect(result.cancelled).toBe(true);
  expect(result.previewSpeed).toBeGreaterThan(100);
  expect(result.previewSpeed).toBeLessThan(190);
  expect(result.speed).toBeGreaterThan(350);
  expect(result.speed).toBeLessThan(510);
  expect(result.stopped).toBe(true);
});
