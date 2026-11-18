import { test, expect, type Page } from "@playwright/test";
import type { Project } from "../src/domain/models";
import type { PerformanceState } from "../src/stores/performanceStore";

interface Hooks {
  getProject: () => Project;
  getPerformance: () => PerformanceState;
  getTrackLevel: (id: string) => number;
  getAudioState: () => { level: number; playing: boolean; tick: number };
}
const hooks = (page: Page) =>
  ({
    project: () =>
      page.evaluate(() =>
        (
          window as unknown as { __studioTest: Hooks }
        ).__studioTest.getProject(),
      ),
    performance: () =>
      page.evaluate(() =>
        (
          window as unknown as { __studioTest: Hooks }
        ).__studioTest.getPerformance(),
      ),
    audio: () =>
      page.evaluate(() =>
        (
          window as unknown as { __studioTest: Hooks }
        ).__studioTest.getAudioState(),
      ),
  }) as const;

async function boot(page: Page) {
  await page.goto("/");
  await page.waitForFunction(
    () => !!(window as unknown as { __studioTest?: Hooks }).__studioTest,
  );
  await expect(page.getByLabel("Project title")).toHaveValue("Sunday, softly");
  await expect(
    page.getByText("All changes saved", { exact: true }),
  ).toBeVisible();
}
async function blankWithKeys(page: Page, name: string) {
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await page.getByLabel("New project name").fill(name);
  await page.getByRole("button", { name: "Create blank project" }).click();
  await page.getByRole("button", { name: "Add track", exact: true }).click();
  await page.getByRole("button", { name: /^Electric Piano / }).click();
}

test("computer keys hold notes on the selected track and release them", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await boot(page);
  const { performance, audio } = hooks(page);
  await page.locator(".arrangement").click({ position: { x: 5, y: 5 } });
  await page.keyboard.down("KeyA");
  await page.waitForTimeout(350);
  expect((await performance()).held).toEqual([48]);
  // Still sounding a third of a second in: this is a held note, not a fixed-length blip.
  expect((await audio()).level).toBeGreaterThan(0.004);
  await page.keyboard.down("KeyG");
  await page.waitForTimeout(100);
  expect((await performance()).held).toEqual([48, 55]);
  await page.keyboard.up("KeyA");
  await page.keyboard.up("KeyG");
  expect((await performance()).held).toEqual([]);
  await page.waitForTimeout(1500);
  expect((await audio()).level).toBeLessThan(0.002);
  // Octave keys move the layout; typing in a text field never plays notes.
  await page.keyboard.press("KeyX");
  expect((await performance()).octave).toBe(4);
  await page.keyboard.press("KeyZ");
  await page.getByLabel("Project title").click();
  await page.keyboard.down("KeyA");
  expect((await performance()).held).toEqual([]);
  await page.keyboard.up("KeyA");
  // Switching the layout off stops the keys from playing.
  await page.locator(".arrangement").click({ position: { x: 5, y: 5 } });
  await page.getByLabel("Play notes with the computer keyboard").click();
  await page.keyboard.down("KeyA");
  expect((await performance()).held).toEqual([]);
  await page.keyboard.up("KeyA");
  expect(errors).toEqual([]);
});

test("records what is played into a new clip, quantized, as one undoable edit", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await boot(page);
  await blankWithKeys(page, "First take");
  const { project, performance } = hooks(page);
  expect((await project()).tracks[0].clips).toHaveLength(1);
  const before = await project();
  await page.getByLabel("Record", { exact: true }).click();
  expect((await performance()).armed).toBe(true);
  await page.getByLabel("Play", { exact: true }).click();
  await page.waitForTimeout(500);
  for (const key of ["KeyA", "KeyD", "KeyG"]) {
    await page.keyboard.down(key);
    await page.waitForTimeout(220);
    await page.keyboard.up(key);
    await page.waitForTimeout(120);
  }
  await page.getByLabel("Stop", { exact: true }).click();
  await expect(page.getByText(/Recorded 3 notes/)).toBeVisible();
  const after = await project();
  const track = after.tracks[0];
  // The blank clip made with the track covers bar one, so the take is overdubbed into it.
  expect(track.clips).toHaveLength(1);
  const clip = track.clips[0];
  const pattern = after.patterns[clip.type === "midi" ? clip.patternId : ""];
  const added = pattern.notes.slice(
    before.patterns[pattern.id]?.notes.length ?? 0,
  );
  expect(added.map((note) => note.pitch)).toEqual([48, 52, 55]);
  for (const note of added) {
    expect(note.startTick % 120).toBe(0);
    expect(note.durationTicks).toBeGreaterThan(60);
  }
  expect(added[1].startTick).toBeGreaterThan(added[0].startTick);
  expect(added[2].startTick).toBeGreaterThan(added[1].startTick);
  await page.getByTitle("Undo · ⌘Z").click();
  const undone = await project();
  expect(undone.tracks).toEqual(before.tracks);
  expect(undone.patterns).toEqual(before.patterns);
  expect(errors).toEqual([]);
});

test("metronome clicks while playing and is silent when switched off", async ({
  page,
}) => {
  await boot(page);
  await blankWithKeys(page, "Click");
  // Read the output level on every animation frame inside the page: a click lasts ~45 ms,
  // which polling from the test process can miss.
  const loudest = (ms: number) =>
    page.evaluate(
      (duration) =>
        new Promise<number>((resolve) => {
          const hooks = (window as unknown as { __studioTest: Hooks })
            .__studioTest;
          const until = performance.now() + duration;
          let peak = 0;
          const read = () => {
            peak = Math.max(peak, hooks.getAudioState().level);
            if (performance.now() < until) requestAnimationFrame(read);
            else resolve(peak);
          };
          read();
        }),
      ms,
    );
  await page.getByLabel("Play", { exact: true }).click();
  // An empty project makes no sound of its own.
  expect(await loudest(900)).toBeLessThan(0.001);
  await page.getByLabel("Metronome", { exact: true }).click();
  expect(await loudest(1500)).toBeGreaterThan(0.003);
  await page.getByLabel("Metronome", { exact: true }).click();
  await page.waitForTimeout(300);
  expect(await loudest(900)).toBeLessThan(0.001);
  await page.getByLabel("Stop", { exact: true }).click();
});

test("a MIDI keyboard plays and records like any other input", async ({
  page,
}) => {
  // A stand-in for a hardware keyboard: one input the test can send messages through.
  await page.addInitScript(() => {
    const input = {
      name: "Test Keys 49",
      onmidimessage: null as null | ((event: { data: number[] }) => void),
    };
    (window as unknown as { __midiInput: typeof input }).__midiInput = input;
    Object.defineProperty(navigator, "requestMIDIAccess", {
      configurable: true,
      value: async () => ({
        inputs: new Map([["test", input]]),
        onstatechange: null,
      }),
    });
  });
  await boot(page);
  const { performance, audio } = hooks(page);
  const send = (data: number[]) =>
    page.evaluate((bytes) => {
      (
        window as unknown as {
          __midiInput: { onmidimessage: (event: { data: number[] }) => void };
        }
      ).__midiInput.onmidimessage({ data: bytes });
    }, data);
  await page.getByLabel("Connect a MIDI keyboard").click();
  await expect(page.getByLabel("Connect a MIDI keyboard")).toContainText(
    "Test Keys 49",
  );
  await send([0x90, 64, 100]);
  await page.waitForTimeout(300);
  expect((await performance()).held).toEqual([64]);
  expect((await audio()).level).toBeGreaterThan(0.004);
  await send([0xb0, 64, 127]); // a pedal message is ignored
  await send([0x90, 64, 0]); // note-on with velocity 0 releases
  expect((await performance()).held).toEqual([]);
});

test("each track shows its own level while the song plays", async ({
  page,
}) => {
  await boot(page);
  await page.getByLabel("Play", { exact: true }).click();
  // Bars 1–4 of the demo have drums and keys but no bass yet.
  await page.waitForTimeout(1200);
  const scale = (index: number) =>
    page
      .locator(".track-row")
      .nth(index)
      .locator(".track-meter i")
      .evaluate((node) =>
        Number(
          (node as HTMLElement).style.transform.replace(/[^0-9.]/g, "") || 0,
        ),
      );
  let drums = 0;
  let bass = 0;
  for (let read = 0; read < 20; read++) {
    drums = Math.max(drums, await scale(0));
    bass = Math.max(bass, await scale(2));
    await page.waitForTimeout(40);
  }
  expect(drums).toBeGreaterThan(0.02);
  expect(bass).toBe(0);
  await page.getByLabel("Stop", { exact: true }).click();
  await page.waitForTimeout(600);
  expect(await scale(0)).toBe(0);
});

test("keys still play along after a reference song is imported and selected", async ({
  page,
}) => {
  await boot(page);
  await page.getByRole("button", { name: "Samples", exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "Import Reference", exact: true })
    .click();
  await (await chooser).setFiles("e2e/fixtures/reference-clicks.wav");
  await expect(page.getByLabel("Reference track analysis")).toBeVisible();
  const { project, performance } = hooks(page);
  const tracks = (await project()).tracks;
  expect(tracks[0].role).toBe("reference");
  // The reference is selected; notes go to the first instrument track (the demo's drums).
  await page.locator(".arrangement").click({ position: { x: 5, y: 5 } });
  // Peak of the drum track's own meter, read every frame for half a second.
  const peak = page.evaluate(
    (id) =>
      new Promise<number>((resolve) => {
        const hooks = (window as unknown as { __studioTest: Hooks })
          .__studioTest;
        const until = performance.now() + 500;
        let highest = 0;
        const read = () => {
          highest = Math.max(highest, hooks.getTrackLevel(id));
          if (performance.now() < until) requestAnimationFrame(read);
          else resolve(highest);
        };
        read();
      }),
    tracks[1].id,
  );
  await page.keyboard.down("KeyA");
  await page.waitForTimeout(100);
  expect((await performance()).held).toEqual([36]);
  const level = await peak;
  await page.keyboard.up("KeyA");
  expect(level).toBeGreaterThan(0.001);
});
