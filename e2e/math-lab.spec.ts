import { test, expect, type Page } from "@playwright/test";
const lab = (page: Page) => page.evaluate("window.__studioTest.getLab()");
const audio = (page: Page) =>
  page.evaluate("window.__studioTest.getAudioState()");
const project = (page: Page) =>
  page.evaluate("window.__studioTest.getProject()");
async function boot(page: Page) {
  await page.goto("/");
  await page.waitForFunction("!!window.__studioTest");
  await page.getByRole("button", { name: "Math Lab", exact: true }).click();
}
test("function shape, safe errors, editable persistence and playable Studio insertion", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await boot(page);
  const before = (await lab(page)).functionPattern.notes.map(
    (n: { pitch: number }) => n.pitch,
  );
  await page.getByLabel("Function expression").fill("sin(2*x) + 0.5*cos(5*x)");
  expect(
    (await lab(page)).functionPattern.notes.map(
      (n: { pitch: number }) => n.pitch,
    ),
  ).not.toEqual(before);
  await page.getByLabel("Function expression").fill("window.alert(1)");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Play melody", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Function expression").fill("sin(x)");
  await page.getByLabel("Step 1 note", { exact: true }).selectOption("62");
  await page.getByLabel("Function BPM").fill("88");
  await expect(page.getByLabel("Step 1 note", { exact: true })).toHaveValue(
    "62",
  );
  await page.reload();
  await expect(page.getByRole("tab", { name: "01 Functions" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByLabel("Step 1 note", { exact: true })).toHaveValue(
    "62",
  );
  await page.getByRole("button", { name: "Play melody", exact: true }).click();
  await expect.poll(async () => (await audio(page)).previewing).toBe(true);
  await expect
    .poll(async () => (await audio(page)).level)
    .toBeGreaterThan(0.001);
  await page
    .locator(".lab-playback")
    .getByRole("button", { name: "Stop", exact: true })
    .click();
  await expect.poll(async () => (await audio(page)).previewing).toBe(false);
  const original = await project(page);
  await page
    .getByRole("button", { name: "Add to Studio", exact: true })
    .click();
  await expect(page.locator(".piano-editor")).toBeVisible();
  const inserted = await project(page);
  expect(inserted.tracks.length).toBe(original.tracks.length + 1);
  const clip = inserted.tracks.at(-1).clips[0];
  expect(inserted.patterns[clip.patternId].notes).toHaveLength(16);
  expect(inserted.patterns[clip.patternId].notes[0].pitch).toBe(62);
  await page.getByLabel("Play", { exact: true }).click();
  await expect.poll(async () => (await audio(page)).playing).toBe(true);
  await page.getByLabel("Stop", { exact: true }).click();
  expect(errors).toEqual([]);
});
test("Fourier live harmonics change audible output, stop, save, and apply to existing notes", async ({
  page,
}) => {
  await boot(page);
  await page.getByRole("tab", { name: "02 Fourier" }).click();
  await page.getByLabel("Fourier preset").selectOption("Pure Sine");
  const key = page.getByRole("button", { name: "Play D4", exact: true });
  await key.focus();
  await page.keyboard.down("Space");
  await expect
    .poll(async () => (await audio(page)).level)
    .toBeGreaterThan(0.01);
  await page.keyboard.up("Space");
  await expect.poll(async () => (await audio(page)).level).toBeLessThan(0.0001);
  await page.getByRole("button", { name: "Hold tone", exact: true }).click();
  await expect
    .poll(async () => (await audio(page)).level)
    .toBeGreaterThan(0.01);
  await page.getByLabel("Harmonic 1", { exact: true }).focus();
  await page.keyboard.press("Home");
  await expect.poll(async () => (await audio(page)).level).toBeLessThan(0.0001);
  await page.getByLabel("Harmonic 2", { exact: true }).focus();
  await page.keyboard.press("End");
  await expect
    .poll(async () => (await audio(page)).level)
    .toBeGreaterThan(0.01);
  await page.getByRole("button", { name: "Stop all sound" }).click();
  await expect.poll(async () => (await audio(page)).level).toBeLessThan(0.0001);
  await page.getByLabel("Preset name").fill("Second harmonic study");
  await page.getByRole("button", { name: "Save sound" }).click();
  await page.reload();
  await expect(page.getByRole("tab", { name: "02 Fourier" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect((await lab(page)).savedPresets[0].instrument.harmonics).toEqual([
    0, 1, 0, 0, 0, 0, 0, 0,
  ]);
  const before = await project(page);
  await page
    .getByLabel("Fourier destination")
    .selectOption(before.tracks[1].id);
  await page.getByRole("button", { name: "Apply sound to Studio" }).click();
  const after = await project(page);
  expect(after.patterns).toEqual(before.patterns);
  expect(after.tracks[1].instrument.harmonics).toEqual([
    0, 1, 0, 0, 0, 0, 0, 0,
  ]);
  await page
    .getByLabel("Instrument", { exact: true })
    .selectOption({ label: "Second harmonic study" });
  expect((await project(page)).tracks[1].instrument.presetName).toBe(
    "Second harmonic study",
  );
  await page.getByRole("button", { name: "Math Lab", exact: true }).click();
  await page.getByRole("button", { name: "Hold tone", exact: true }).click();
  await page.getByRole("tab", { name: "01 Functions" }).click();
  await expect.poll(async () => (await audio(page)).level).toBeLessThan(0.0001);
});
test("Bayesian feedback changes genuine counts, persists contexts, generates and inserts a melody in both themes", async ({
  page,
}) => {
  await boot(page);
  await page.getByRole("tab", { name: "03 Bayesian" }).click();
  const before = await lab(page);
  await page.getByRole("button", { name: "Suggest next note" }).click();
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(page.locator(".lab-feedback")).toContainText(
    "One observation added",
  );
  let state = await lab(page);
  expect(Object.keys(state.bayesModel)).toHaveLength(1);
  expect(
    Object.values(state.bayesModel)
      .flatMap((r: any) => r.accepted)
      .reduce((a: any, b: any) => a + b, 0),
  ).toBe(1);
  expect(state.bayesPattern.notes.length).toBe(1);
  await page.getByRole("button", { name: "Suggest next note" }).click();
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(page.locator(".lab-feedback")).toContainText(
    "no negative count",
  );
  state = await lab(page);
  expect(
    Object.values(state.bayesModel)
      .flatMap((r: any) => r.rejected)
      .reduce((a: any, b: any) => a + b, 0),
  ).toBe(1);
  await page.getByRole("button", { name: "Generate 16 notes" }).click();
  expect((await lab(page)).bayesPattern.notes).toHaveLength(16);
  await page.reload();
  expect((await lab(page)).bayesModel).toEqual(state.bayesModel);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator(".math-lab").evaluate((el) => (el.scrollTop = 0));
  await page.screenshot({ path: "docs/screenshots/math-bayesian-light.png" });
  await page.getByLabel("Switch to dark theme").click();
  await page.waitForTimeout(200); // Let the 150 ms theme transition finish for the artifact.
  await page.screenshot({ path: "docs/screenshots/math-bayesian-dark.png" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Play melody", exact: true }).click();
  await expect.poll(async () => (await audio(page)).previewing).toBe(true);
  await page
    .getByRole("button", { name: "Add to Studio", exact: true })
    .click();
  expect((await project(page)).tracks.at(-1).name).toBe("Bayesian melody");
  expect(before.bayesModel).toEqual({});
});
test("actual PeriodicWave rendering follows harmonic coefficients and zero settings are silent", async ({
  page,
}) => {
  await page.goto("/e2e/fixture.html");
  await page.waitForFunction("!!window.audioTest");
  const signal = await page.evaluate(async () => {
    const path = "/src/audio/graph.ts";
    const { synthesize } = await import(/* @vite-ignore */ path);
    async function render(harmonics: number[]) {
      const c = new OfflineAudioContext(1, 44100, 44100);
      synthesize(
        c,
        c.destination,
        {
          type: "fourier",
          harmonics,
          brightness: 0.5,
          attack: 0.01,
          release: 0.1,
        },
        69,
        0.8,
        0,
        0.6,
        1,
      );
      const b = await c.startRendering();
      const d = b.getChannelData(0);
      let rms = 0;
      const energy = (hz: number) => {
        let real = 0,
          imag = 0;
        for (let i = 4410; i < 22050; i++) {
          real += d[i] * Math.cos((2 * Math.PI * hz * i) / 44100);
          imag += d[i] * Math.sin((2 * Math.PI * hz * i) / 44100);
        }
        return real * real + imag * imag;
      };
      for (const v of d) rms += v * v;
      return { a: energy(440), b: energy(880), rms: Math.sqrt(rms / d.length) };
    }
    return {
      sine: await render([1, 0, 0, 0, 0, 0, 0, 0]),
      second: await render([0, 1, 0, 0, 0, 0, 0, 0]),
      silent: await render(Array(8).fill(0)),
    };
  });
  expect(signal.sine.rms).toBeGreaterThan(0.01);
  expect(signal.sine.a).toBeGreaterThan(signal.sine.b * 100);
  expect(signal.second.b).toBeGreaterThan(signal.second.a * 100);
  expect(signal.silent.rms).toBe(0);
  console.log("Fourier rendered spectrum", signal);
});

test("releasing or stopping while audio activation is pending never leaves a Fourier voice playing", async ({
  page,
}) => {
  await page.goto("/e2e/fixture.html");
  await page.waitForFunction("!!window.audioTest");
  await page.getByRole("button", { name: "Activate audio" }).click();
  const result = await page.evaluate(async () => {
    const engine = window.audioTest.engine;
    const instrument = {
      type: "fourier" as const,
      harmonics: [1, 0, 0, 0, 0, 0, 0, 0],
      attack: 0.01,
      release: 0.05,
      brightness: 0.5,
    };
    const down = engine.labNoteOn(instrument, 62, 0.8);
    engine.labNoteOff(62);
    await down;
    const second = engine.labNoteOn(instrument, 64, 0.8);
    engine.stop();
    await second;
    await new Promise((resolve) => setTimeout(resolve, 150));
    return { level: engine.getLevel(), playing: engine.isPlaying() };
  });
  expect(result.level).toBeLessThan(0.0001);
  expect(result.playing).toBe(false);
});
