import { test, expect, type Page } from "@playwright/test";

declare global {
  interface Window {
    __studioTest: {
      getProject: () => import("../src/domain/models").Project;
      hasAsset: (id: string) => boolean;
    };
  }
}
async function project(page: Page) {
  return page.evaluate(() => window.__studioTest.getProject());
}
async function boot(page: Page) {
  await page.goto("/");
  await page.waitForFunction(() => !!window.__studioTest);
  await expect(page.getByLabel("Project title")).toHaveValue("Sunday, softly");
  await expect(
    page.getByText("All changes saved", { exact: true }),
  ).toBeVisible();
}

test("edits, resizes and quantizes piano notes; copies clips; restores complete project after reload", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await boot(page);
  const original = await project(page);
  const id = original.tracks[1].clips[0].patternId;
  const scroll = page.locator(".roll-scroll");
  await scroll.scrollIntoViewIfNeeded();
  const box = await scroll.boundingBox();
  if (!box) throw new Error("No editor");
  const empty = await page.evaluate(() => {
    const r = document.querySelector(".roll-scroll")!.getBoundingClientRect();
    for (let y = r.top + 32; y < r.bottom - 15; y += 9) {
      const x = r.left + 96;
      if (document.elementFromPoint(x, y)?.classList.contains("roll-grid"))
        return { x, y };
    }
    throw new Error("No empty grid point visible");
  });
  await page.mouse.click(empty.x, empty.y);
  let p = await project(page);
  expect(p.patterns[id].notes.length).toBe(
    original.patterns[id].notes.length + 1,
  );
  const added = p.patterns[id].notes.at(-1)!;
  let note = page.locator(".midi-note.is-selected");
  let nbox = await note.boundingBox();
  if (!nbox) throw new Error("No note");
  await page.mouse.move(nbox.x + nbox.width - 2, nbox.y + 6);
  await page.mouse.down();
  await page.mouse.move(nbox.x + nbox.width + 28, nbox.y + 6, { steps: 5 });
  await page.mouse.up();
  p = await project(page);
  expect(
    p.patterns[id].notes.find((n) => n.id === added.id)!.durationTicks,
  ).toBeGreaterThan(added.durationTicks);
  await page.getByRole("button", { name: "Quantize", exact: true }).click();
  await page.getByRole("button", { name: "Copy notes", exact: true }).click();
  await page.locator(".piano-editor").focus();
  await page.keyboard.press("Control+v");
  p = await project(page);
  expect(p.patterns[id].notes.length).toBe(
    original.patterns[id].notes.length + 2,
  );
  await page
    .getByRole("button", { name: "Duplicate clip", exact: true })
    .click();
  p = await project(page);
  expect(p.tracks[1].clips.length).toBe(5);
  const clip = page.locator(".track-row").nth(1).locator(".clip").first();
  const cbox = await clip.boundingBox();
  if (!cbox) throw new Error("No clip");
  await page.mouse.move(cbox.x + 20, cbox.y + 12);
  await page.mouse.down();
  await page.mouse.move(cbox.x + 86, cbox.y + 12, { steps: 5 });
  await page.mouse.up();
  p = await project(page);
  expect(p.tracks[1].clips[0].startTick).toBe(1920);
  await page.getByLabel("Project title").fill("Saved composition");
  await page.getByLabel("Save project", { exact: true }).click();
  await expect(page.locator(".toast")).toContainText(
    "Project saved in this browser.",
  );
  const saved = await project(page);
  await page.reload();
  await expect(page.getByLabel("Project title")).toHaveValue(
    "Saved composition",
  );
  const restored = await project(page);
  expect(restored).toEqual(saved);
  expect(errors).toEqual([]);
});

test("creates a blank 90 BPM project, drum groove, keys and bass; Undo/Redo preserves edits", async ({
  page,
}) => {
  await boot(page);
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await page.getByLabel("New project name").fill("From nothing");
  await page.getByRole("button", { name: "Create blank project" }).click();
  await expect(page.getByLabel("BPM", { exact: true })).toHaveValue("90");
  expect((await project(page)).tracks).toHaveLength(0);
  await page.getByRole("button", { name: "Add track", exact: true }).click();
  await page.getByRole("button", { name: /Drum Kit Six original/ }).click();
  for (const step of [1, 5, 9, 13])
    await page
      .getByRole("button", { name: `Kick step ${step}, off`, exact: true })
      .click();
  await page
    .getByRole("button", { name: "Snare step 5, off", exact: true })
    .click();
  let p = await project(page);
  expect(Object.values(p.patterns)[0].notes).toHaveLength(5);
  await page.getByTitle("Undo · ⌘Z").click();
  expect(Object.values((await project(page)).patterns)[0].notes).toHaveLength(
    4,
  );
  await page.getByTitle("Redo · ⇧⌘Z").click();
  expect(Object.values((await project(page)).patterns)[0].notes).toHaveLength(
    5,
  );
  await page.getByRole("button", { name: "Add track", exact: true }).click();
  await page.getByRole("button", { name: /Electric Piano Warm/ }).click();
  await page.getByRole("button", { name: "Chord", exact: true }).click();
  await page.getByRole("button", { name: "Add track", exact: true }).click();
  await page.getByRole("button", { name: /Synth Bass A soft/ }).click();
  const scroll = page.locator(".roll-scroll");
  await scroll.scrollIntoViewIfNeeded();
  const b = await scroll.boundingBox();
  if (!b) throw new Error("No roll");
  await page.mouse.click(b.x + 80, b.y + 65);
  p = await project(page);
  expect(p.tracks).toHaveLength(3);
  expect(
    Object.values(p.patterns).reduce((sum, v) => sum + v.notes.length, 0),
  ).toBeGreaterThan(8);
  await page.getByLabel("Mute Drum Kit", { exact: true }).click();
  await page.getByLabel("Solo Synth Bass", { exact: true }).click();
  p = await project(page);
  expect(p.tracks[0].mixer.mute).toBe(true);
  expect(p.tracks[2].mixer.solo).toBe(true);
});

test("theme change preserves live transport and project; supports narrow desktops", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await boot(page);
  const before = await project(page);
  await page.getByLabel("Play", { exact: true }).click();
  await page.waitForTimeout(400);
  const first = await page.getByLabel("Playback position").innerText();
  await page.getByLabel("Switch to dark theme").click();
  await page.waitForTimeout(300);
  await expect(page.getByLabel("Pause", { exact: true })).toBeVisible();
  expect(await page.getByLabel("Playback position").innerText()).not.toBe(
    first,
  );
  expect(await project(page)).toEqual(before);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByLabel("Stop", { exact: true }).click();
  await page.waitForTimeout(200);
  await page.screenshot({
    path: "docs/screenshots/studio-dark.png",
    fullPage: true,
  });
  await page.getByLabel("Switch to light theme").click();
  await page.waitForTimeout(200);
  await page.screenshot({
    path: "docs/screenshots/studio-light.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 850 });
  await expect(page.getByLabel("Play", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "docs/screenshots/studio-laptop.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("imports an audio file, restores it, generates and edits local inspiration, and downloads real WAV", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await boot(page);
  await page.getByRole("button", { name: "Samples", exact: true }).click();
  await page
    .locator("input[type=file]")
    .setInputFiles("public/samples/felt-kick.wav");
  await expect(page.locator(".toast")).toContainText(
    "added to the arrangement",
  );
  await page.getByTitle("Close dialog").click();
  let p = await project(page);
  expect(p.assets).toHaveLength(1);
  expect(p.tracks.at(-1)!.clips[0].type).toBe("audio");
  await page.getByLabel("Save project", { exact: true }).click();
  await expect(page.locator(".toast")).toContainText(
    "Project saved in this browser.",
  );
  await page.reload();
  await expect(
    page.getByText("All changes saved", { exact: true }),
  ).toBeVisible();
  p = await project(page);
  expect(p.assets).toHaveLength(1);
  expect(
    await page.evaluate(() =>
      window.__studioTest.hasAsset(
        window.__studioTest.getProject().assets[0].id,
      ),
    ),
  ).toBe(true);
  await page.getByRole("button", { name: /AI Ideas/ }).click();
  await page
    .getByRole("button", { name: "Explore ideas", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Use idea", exact: true }),
  ).toHaveCount(3);
  await page
    .getByRole("button", { name: "Use idea", exact: true })
    .first()
    .click();
  await page.getByTitle("Close dialog").click();
  p = await project(page);
  expect(p.tracks).toHaveLength(7);
  const idea = p.tracks.at(-1)!;
  expect(idea.instrument.type).toBe("synth-bass");
  const ideaPattern = p.patterns[idea.clips[0].patternId];
  expect(ideaPattern.notes.length).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Chord", exact: true }).click();
  expect((await project(page)).patterns[ideaPattern.id].notes.length).toBe(
    ideaPattern.notes.length + 4,
  );
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export WAV", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.wav$/);
  expect(await download.failure()).toBe(null);
  expect(errors).toEqual([]);
});

test("highlights the right scale, spells notes for the key, and moves playheads without re-rendering", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await boot(page);
  // Row i of the grid is MIDI pitch 127 - i.
  const inScale = (pitch: number) =>
    page.evaluate(
      (index) =>
        document
          .querySelectorAll(".roll-row")
          [index].classList.contains("in-scale"),
      127 - pitch,
    );
  // C minor: E♭ belongs, E does not.
  expect(await inScale(63)).toBe(true);
  expect(await inScale(64)).toBe(false);
  await expect(page.getByLabel("Audition E♭4", { exact: true })).toHaveCount(1);
  // Keys with ♭ or ♯ roots used to fall back to the C scale.
  await page.getByLabel("Musical key").selectOption("E♭ minor");
  expect(await inScale(63)).toBe(true); // E♭, the tonic
  expect(await inScale(66)).toBe(true); // G♭, the minor third
  expect(await inScale(64)).toBe(false); // E natural
  expect(await inScale(60)).toBe(false); // C natural
  await page.getByLabel("Musical key").selectOption("E major");
  await expect(page.getByLabel("Audition D♯4", { exact: true })).toHaveCount(1);
  await page.getByLabel("Musical key").selectOption("C minor");
  // The chord menu offers the chords of the key and inserts the chosen voicing.
  const before = await project(page);
  const id = before.tracks[1].clips[0].patternId;
  await page.getByLabel("Chord in key").selectOption({ label: "iv · Fm7" });
  await page.getByLabel("Chord voicing").selectOption("rootless");
  await page.getByRole("button", { name: "Chord", exact: true }).click();
  const after = await project(page);
  const added = after.patterns[id].notes.slice(
    before.patterns[id].notes.length,
  );
  expect(added.map((n) => n.pitch % 12).sort((a, b) => a - b)).toEqual([
    0, 3, 7, 8,
  ]);
  await page.getByTitle("Undo · ⌘Z").click();
  // Playheads are moved by transform while playing; the timeline DOM is not rebuilt.
  await page.evaluate(() => {
    (window as unknown as { __clip: Element | null }).__clip =
      document.querySelector(".clip");
  });
  await page.getByLabel("Play", { exact: true }).click();
  await page.waitForTimeout(500);
  const first = await page
    .locator(".timeline-playhead")
    .evaluate((node) => (node as HTMLElement).style.transform);
  await page.waitForTimeout(300);
  const second = await page
    .locator(".timeline-playhead")
    .evaluate((node) => (node as HTMLElement).style.transform);
  expect(first).toMatch(/^translateX\(/);
  expect(second).not.toBe(first);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __clip: Element | null }).__clip ===
        document.querySelector(".clip"),
    ),
  ).toBe(true);
  await expect(page.locator(".editor-playhead")).toBeVisible();
  await page.getByLabel("Stop", { exact: true }).click();
  expect(errors).toEqual([]);
});

test("every instrument preset can be added, auditioned, played and exported without errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await boot(page);
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await page.getByLabel("New project name").fill("All voices");
  await page.getByRole("button", { name: "Create blank project" }).click();
  const presets = [
    "Electric Piano",
    "Felt Piano",
    "Synth Bass",
    "Sub Bass",
    "Synth Pad",
    "Lead Synth",
    "Pluck",
  ];
  for (const name of presets) {
    await page.getByRole("button", { name: "Add track", exact: true }).click();
    await page.getByRole("button", { name: new RegExp(`^${name} `) }).click();
    // Inserting a chord also auditions each of its notes through the new voice.
    await page.getByRole("button", { name: "Chord", exact: true }).click();
  }
  const p = await project(page);
  expect(p.tracks.map((t) => t.name)).toEqual(presets);
  expect(new Set(p.tracks.map((t) => t.instrument.type)).size).toBe(7);
  await page.getByLabel("Play", { exact: true }).click();
  await page.waitForTimeout(700);
  const level = await page
    .locator(".level-meter")
    .getAttribute("aria-valuenow");
  expect(Number(level)).toBeGreaterThan(0);
  await page.getByLabel("Stop", { exact: true }).click();
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export WAV", exact: true }).click();
  expect((await downloadPromise).suggestedFilename()).toBe("All voices.wav");
  expect(errors).toEqual([]);
});
