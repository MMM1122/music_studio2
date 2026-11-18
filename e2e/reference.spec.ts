import { test, expect, type Page } from "@playwright/test";
const project = (page: Page) =>
  page.evaluate("window.__studioTest.getProject()");
const audio = (page: Page) =>
  page.evaluate("window.__studioTest.getAudioState()");
async function boot(page: Page) {
  await page.goto("/");
  await page.waitForFunction("!!window.__studioTest");
  await expect(page.getByLabel("Project title")).toHaveValue("Sunday, softly");
}
async function importReference(page: Page, filename = "reference-clicks.wav") {
  await page.getByRole("button", { name: "Samples", exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "Import Reference", exact: true })
    .click();
  await (await chooser).setFiles(`e2e/fixtures/${filename}`);
  await expect(page.getByLabel("Reference track analysis")).toBeVisible();
  await expect(page.getByTestId("reference-waveform")).toHaveAttribute(
    "data-peak-count",
    "4096",
  );
}
test("imports WAV reference above existing composition, renders PCM and switches A/B on one clock", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1100 });
  await boot(page);
  const original = await project(page);
  await importReference(page);
  const p = await project(page);
  expect(p.tracks[0].role).toBe("reference");
  expect(p.tracks.slice(1)).toEqual(original.tracks);
  expect(p.transport.bpm).toBe(original.transport.bpm);
  expect(p.transport.loop).toBe(false);
  expect(p.assets[0].duration).toBeCloseTo(12, 2);
  await page
    .getByRole("button", { name: "Play timeline", exact: true })
    .click();
  await expect.poll(async () => (await audio(page)).playing).toBe(true);
  const spectrum = page.getByRole("img", {
    name: "Reference frequency spectrum",
  });
  await spectrum.scrollIntoViewIfNeeded();
  await expect
    .poll(async () => Number(await spectrum.getAttribute("data-peak-db")), {
      // Sample faster than these short 120 BPM fixture clicks to avoid aliasing
      // the default 500/1000 ms polling interval with the silent spaces.
      intervals: [37],
    })
    .toBeGreaterThan(-80);
  const group = page.getByRole("group", { name: "Reference A/B listening" });
  await group
    .getByRole("button", { name: "My Composition", exact: true })
    .click();
  await expect
    .poll(async () => (await audio(page)).referenceMode)
    .toBe("composition");
  await group.getByRole("button", { name: "Reference", exact: true }).click();
  await expect
    .poll(async () => (await audio(page)).referenceMode)
    .toBe("reference");
  await group.getByRole("button", { name: "Both", exact: true }).click();
  await page
    .getByRole("button", { name: "Pause timeline", exact: true })
    .click();
  const paused = (await audio(page)).tick;
  await page.waitForTimeout(100);
  expect((await audio(page)).tick).toBeCloseTo(paused, 1);
  await page.getByLabel("Reference waveform zoom").selectOption("4");
  await page.getByLabel("Reference waveform position").fill("4");
  const canvas = page.getByRole("slider", { name: "Reference waveform seek" });
  await canvas.click({ position: { x: 100, y: 60 } });
  expect((await audio(page)).tick).toBeGreaterThan(((4 * 86) / 60) * 480);
  await page
    .getByRole("button", { name: "Audio Analysis", exact: true })
    .click();
  await expect(canvas).not.toBeVisible();
  await page
    .getByRole("button", { name: "Audio Analysis", exact: true })
    .click();
  await expect(page.locator(".toast")).not.toBeVisible();
  await page.getByLabel("Reference waveform zoom").selectOption("1");
  await page
    .locator(".reference-analysis")
    .screenshot({ path: "docs/screenshots/reference-analysis-light.png" });
  await page.getByLabel("Switch to dark theme").click();
  await page.waitForTimeout(200);
  await page
    .locator(".reference-analysis")
    .screenshot({ path: "docs/screenshots/reference-analysis-dark.png" });
  expect(errors).toEqual([]);
});
test("estimates locally, corrects BPM explicitly, edits timestamp markers and restores saved reference", async ({
  page,
}) => {
  await boot(page);
  await importReference(page);
  const initial = await project(page);
  await page.getByRole("button", { name: "Estimate BPM", exact: true }).click();
  await expect
    .poll(async () => (await project(page)).tracks[0].reference.tempo?.bpm ?? 0)
    .toBeGreaterThan(0);
  const result = (await project(page)).tracks[0].reference.tempo;
  expect(
    Math.min(
      ...[result.bpm, ...result.alternatives].map((v: number) =>
        Math.abs(v - 120),
      ),
    ),
  ).toBeLessThan(3);
  expect((await project(page)).transport.bpm).toBe(initial.transport.bpm);
  await page.getByLabel("Reference manual BPM").fill("100");
  await page
    .getByRole("button", { name: "Set project BPM", exact: true })
    .click();
  const changed = await project(page);
  expect(changed.transport.bpm).toBe(100);
  expect(
    ((changed.tracks[0].clips[0].durationTicks / 480) * 60) / 100,
  ).toBeCloseTo(12, 2);
  await page.getByLabel("New reference marker label").selectOption("Verse");
  await page.getByLabel("New reference marker time").fill("2.5");
  await page.getByRole("button", { name: "Add marker", exact: true }).click();
  await page.getByLabel("Marker label Verse", { exact: true }).fill("Chorus");
  await page.getByLabel("Marker time Chorus", { exact: true }).fill("4");
  await page
    .getByRole("button", { name: "Jump to Chorus at 0:04", exact: true })
    .click();
  expect((await audio(page)).tick).toBeCloseTo(3200, 0);
  await page.getByLabel("Save project", { exact: true }).click();
  await expect(page.locator(".toast")).toContainText("Project saved");
  const saved = await project(page);
  await page.reload();
  await page.waitForFunction("!!window.__studioTest");
  await page.locator(".track-row").first().locator(".track-header").click();
  await expect(page.getByTestId("reference-waveform")).toHaveAttribute(
    "data-peak-count",
    "4096",
  );
  const restored = await project(page);
  expect(restored.tracks[0]).toEqual(saved.tracks[0]);
  expect(
    await page.evaluate(
      (id) => window.__studioTest.hasAsset(id),
      restored.assets[0].id,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Delete marker Chorus", exact: true })
    .click();
  expect((await project(page)).tracks[0].reference.markers).toHaveLength(0);
});
test("rejects empty or corrupt files without changing the project; ordinary imports remain ordinary", async ({
  page,
}) => {
  await boot(page);
  const before = await project(page);
  await page.getByRole("button", { name: "Samples", exact: true }).click();
  await page.getByLabel("Audio import file").setInputFiles({
    name: "empty.wav",
    mimeType: "audio/wav",
    buffer: Buffer.alloc(0),
  });
  await expect(page.getByRole("alert")).toContainText("empty");
  await page.getByLabel("Audio import file").setInputFiles({
    name: "broken.mp3",
    mimeType: "audio/mpeg",
    buffer: Buffer.from("This is not audio"),
  });
  await expect(page.getByRole("alert")).toContainText("could not be decoded");
  expect((await project(page)).tracks).toEqual(before.tracks);
  expect((await project(page)).assets).toEqual([]);
  await page
    .getByLabel("Audio import file")
    .setInputFiles("e2e/fixtures/reference-clicks.wav");
  await expect(page.locator(".toast")).toContainText(
    "added to the arrangement",
  );
  expect((await project(page)).tracks.at(-1).role).toBeUndefined();
});
test("decodes a self-generated MP3 through the same reference importer", async ({
  page,
}) => {
  await boot(page);
  await importReference(page, "reference-clicks.mp3");
  const p = await project(page);
  expect(p.assets[0].mimeType).toBe("audio/mpeg");
  expect(p.assets[0].duration).toBeGreaterThanOrEqual(12);
  expect(p.assets[0].duration).toBeLessThan(12.3);
  expect(p.tracks[0].role).toBe("reference");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await expect(page.locator(".export-summary")).toContainText(
    "Reference tracks are always excluded",
  );
});

test("removing the last reference restores composition monitoring; deleting its project releases PCM", async ({
  page,
}) => {
  await boot(page);
  await importReference(page);
  const imported = await project(page);
  const assetId = imported.assets[0].id;
  await page
    .getByRole("group", { name: "Reference A/B listening" })
    .getByRole("button", { name: "Reference", exact: true })
    .click();
  await page.getByRole("button", { name: "Delete track", exact: true }).click();
  await expect.poll(async () => (await audio(page)).referenceMode).toBe("both");
  await expect(
    page.getByRole("group", { name: "Reference A/B listening" }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect
    .poll(async () => (await audio(page)).level)
    .toBeGreaterThan(0.001);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  // Undo remains possible in the same session, so a track deletion keeps its PCM.
  expect(
    await page.evaluate((id) => window.__studioTest.hasAsset(id), assetId),
  ).toBe(true);
  await page.getByLabel("Save project", { exact: true }).click();
  await expect(page.locator(".toast")).toContainText("Project saved");
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await page
    .getByTitle(`Delete project ${imported.name}`, { exact: true })
    .click();
  await page.getByRole("button", { name: "Yes", exact: true }).click();
  await expect.poll(async () => (await project(page)).id).not.toBe(imported.id);
  await expect
    .poll(() =>
      page.evaluate((id) => window.__studioTest.hasAsset(id), assetId),
    )
    .toBe(false);
});
