import { test, expect } from "@playwright/test";
import type { Project } from "../src/domain/models";

const project = (page: import("@playwright/test").Page) =>
  page.evaluate("window.__studioTest.getProject()") as Promise<Project>;

test("the featured song loads as a reference track in one click and survives a reload", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.waitForFunction("!!window.__studioTest");
  await expect(page.getByLabel("Project title")).toHaveValue("Sunday, softly");
  const tracksBefore = (await project(page)).tracks.length;
  const bpmBefore = (await project(page)).transport.bpm;

  await page.getByRole("button", { name: "Samples", exact: true }).click();
  const card = page.getByLabel("Featured reference song");
  await expect(card).toContainText("感官浮游 (Live)");
  await expect(card).toContainText("周笔畅");
  await page
    .getByRole("button", { name: "Load 感官浮游 (Live) as a reference track" })
    .click();
  await expect(page.getByLabel("Reference track analysis")).toBeVisible({
    timeout: 30_000,
  });

  const p = await project(page);
  expect(p.tracks).toHaveLength(tracksBefore + 1);
  const reference = p.tracks[0];
  expect(reference.role).toBe("reference");
  expect(reference.name).toBe("感官浮游 (Live)");
  const asset = p.assets.find((a) => a.id === "featured-sensory-drift")!;
  // Timed from the decoded audio, not a guess: 3 min 28 s.
  expect(asset.duration).toBeGreaterThan(207);
  expect(asset.duration).toBeLessThan(209.5);
  expect(p.transport.bpm).toBe(bpmBefore);

  // The song plays: the reference track's own meter moves.
  await page.getByLabel("Play", { exact: true }).click();
  const peak = await page.evaluate(
    (id) =>
      new Promise<number>((resolve) => {
        const hooks = (
          window as unknown as {
            __studioTest: { getTrackLevel: (id: string) => number };
          }
        ).__studioTest;
        const until = performance.now() + 2500;
        let highest = 0;
        const read = () => {
          highest = Math.max(highest, hooks.getTrackLevel(id));
          if (performance.now() < until) requestAnimationFrame(read);
          else resolve(highest);
        };
        read();
      }),
    reference.id,
  );
  await page.getByLabel("Stop", { exact: true }).click();
  expect(peak).toBeGreaterThan(0.01);

  // Saved with the project: still there after a reload.
  await page.keyboard.press("Control+s");
  await expect(
    page.getByText("All changes saved", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.waitForFunction("!!window.__studioTest");
  const reloaded = await project(page);
  expect(reloaded.tracks[0].role).toBe("reference");
  expect(reloaded.tracks[0].name).toBe("感官浮游 (Live)");
  expect(errors).toEqual([]);
});
