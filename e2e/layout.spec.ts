import { test, expect, type Page } from "@playwright/test";

async function open(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.goto("/");
  await page.waitForFunction("!!window.__studioTest");
  await expect(page.getByLabel("Project title")).toHaveValue("Sunday, softly");
  await page.locator(".clip", { hasText: "Cm9" }).first().dblclick();
  await expect(page.locator(".roll-scroll")).toBeVisible();
}
const box = async (page: Page, selector: string) =>
  (await page.locator(selector).first().boundingBox())!;

for (const [width, height] of [
  [1440, 900],
  [1280, 760],
]) {
  test(`the piano roll is on screen without scrolling at ${width}×${height}`, async ({
    page,
  }) => {
    await open(page, width, height);
    const grid = await box(page, ".roll-scroll");
    const footer = await box(page, ".workspace-footer");
    // At least 150 px of note grid, wholly above the footer, with the page unscrolled.
    expect(
      await page.locator("main.workspace").evaluate((el) => el.scrollTop),
    ).toBe(0);
    expect(grid.height).toBeGreaterThanOrEqual(150);
    expect(grid.y + grid.height).toBeLessThanOrEqual(footer.y + 1);
    // The arrangement still shows at least two full tracks.
    const lanes = await box(page, ".arrangement .timeline-scroll");
    expect(lanes.height).toBeGreaterThanOrEqual(150);
  });
}

test("the split between arrangement and editor can be dragged, stepped, remembered and reset", async ({
  page,
}) => {
  // Measured against the plain heading; the orbit scene takes some of the lanes' room.
  await page.addInitScript(() =>
    localStorage.setItem("studio.orbit-open", "0"),
  );
  await open(page, 1440, 900);
  const lanes = () => box(page, ".arrangement .timeline-scroll");
  const grid = () => box(page, ".roll-scroll");
  const divider = page.getByRole("separator", {
    name: "Resize arrangement and editor",
  });
  const before = await lanes();
  const gridBefore = await grid();

  const handle = (await divider.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 6);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 6 - 80, {
    steps: 6,
  });
  await page.mouse.up();
  const dragged = await lanes();
  expect(dragged.height).toBeCloseTo(before.height - 80, -1);
  // The editor gains what the arrangement gives up.
  expect((await grid()).height).toBeGreaterThan(gridBefore.height + 60);

  await divider.focus();
  await page.keyboard.press("ArrowDown");
  expect((await lanes()).height).toBeCloseTo(dragged.height + 24, -1);
  await page.keyboard.press("Home");
  expect((await lanes()).height).toBeCloseTo(120, -1);
  await page.keyboard.press("ArrowDown");
  const stepped = (await lanes()).height;

  await page.reload();
  await page.waitForFunction("!!window.__studioTest");
  await page.locator(".clip", { hasText: "Cm9" }).first().dblclick();
  expect((await lanes()).height).toBeCloseTo(stepped, -1);

  await divider.dblclick();
  expect((await lanes()).height).toBeCloseTo(before.height, -1);
});

test("no text is set below 10 px and secondary text meets 4.5:1 contrast", async ({
  page,
}) => {
  await open(page, 1440, 900);
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (t) => document.documentElement.setAttribute("data-theme", t),
      theme,
    );
    const report = await page.evaluate(() => {
      const parse = (c: string) =>
        c
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number);
      const lum = (rgb: number[]) => {
        const [r, g, b] = rgb.map((v) => {
          const c = v / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const ratio = (a: number[], b: number[]) => {
        const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
        return (x + 0.05) / (y + 0.05);
      };
      const color = (name: string) => {
        const probe = document.createElement("span");
        probe.style.color = `var(${name})`;
        document.body.append(probe);
        const value = parse(getComputedStyle(probe).color);
        probe.remove();
        return value;
      };
      const background = color("--color-background");
      const surface = color("--color-surface");
      let smallest = 99;
      let where = "";
      for (const element of Array.from(document.querySelectorAll("body *"))) {
        // Words only: a lone "●" status dot is a glyph, not text to read.
        const text = Array.from(element.childNodes).some(
          (node) =>
            node.nodeType === 3 && /[\p{L}\p{N}]/u.test(node.textContent!),
        );
        if (!text || !(element as HTMLElement).offsetParent) continue;
        const size = parseFloat(getComputedStyle(element).fontSize);
        if (size < smallest) {
          smallest = size;
          where = element.className.toString() || element.tagName;
        }
      }
      return {
        smallest,
        where,
        secondary: Math.min(
          ratio(color("--color-text-secondary"), background),
          ratio(color("--color-text-secondary"), surface),
        ),
        muted: ratio(color("--color-text-muted"), background),
      };
    });
    expect(
      report.smallest,
      `smallest text: ${report.where}`,
    ).toBeGreaterThanOrEqual(10);
    expect(report.secondary).toBeGreaterThanOrEqual(4.5);
    expect(report.muted).toBeGreaterThanOrEqual(4.5);
  }
});

test("fit to window shows the whole song in the arrangement", async ({
  page,
}) => {
  await open(page, 1280, 760);
  const lanes = page.locator(".arrangement .timeline-scroll");
  for (let i = 0; i < 4; i++) await page.getByTitle("Zoom in timeline").click();
  // Zoomed in, the song runs past the right edge.
  const lastClip = async () => {
    const boxes = await page
      .locator(".arrangement .clip")
      .evaluateAll((clips) =>
        clips.map((clip) => clip.getBoundingClientRect().right),
      );
    return Math.max(...boxes);
  };
  const visibleRight = async () =>
    (await lanes.evaluate((el) => el.getBoundingClientRect().right)) as number;
  expect(await lastClip()).toBeGreaterThan(await visibleRight());

  await page.getByRole("button", { name: "Fit song to window" }).click();
  expect(await lanes.evaluate((el) => el.scrollLeft)).toBe(0);
  const right = await lastClip();
  const edge = await visibleRight();
  // The end of the song is on screen and uses most of the width.
  expect(right).toBeLessThanOrEqual(edge);
  const left = (await page
    .locator(".arrangement .timeline-ruler")
    .first()
    .evaluate((el) => el.getBoundingClientRect().left)) as number;
  expect(right - left).toBeGreaterThan((edge - left) * 0.8);
});

test("the playhead passes under the track names when the timeline scrolls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.waitForFunction("!!window.__studioTest");
  await expect(page.getByLabel("Project title")).toHaveValue("Sunday, softly");
  const lanes = page.locator(".arrangement .timeline-scroll");
  const label = page.locator(".arrangement .ruler-label");
  // At bar 1 the playhead sits on the left edge of the lanes, just right of the label.
  await lanes.evaluate((el) => (el.scrollLeft = 0));
  await page.waitForTimeout(150);
  const clear = await label.screenshot();
  // Scrolled 100 px, bar 1 is behind the sticky label column: the label must cover it.
  await lanes.evaluate((el) => (el.scrollLeft = 100));
  await page.waitForTimeout(150);
  const scrolled = await label.screenshot();
  expect(scrolled.equals(clear)).toBe(true);
  // The same holds for every track name.
  const header = page.locator(".arrangement .track-header").first();
  const headerScrolled = await header.screenshot();
  await lanes.evaluate((el) => (el.scrollLeft = 0));
  await page.waitForTimeout(150);
  expect((await header.screenshot()).equals(headerScrolled)).toBe(true);
});

test("the twin orbit opens on tall windows, follows the music and can be hidden", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await open(page, 1440, 900);
  const scene = page.locator(".orbit-scene");
  await expect(scene).toBeVisible();
  await expect(scene).toHaveAttribute("data-voices", "Small hours|Round bass");
  await expect(scene).toHaveAttribute("data-state", "rest");
  await page.keyboard.press("Space");
  await expect
    .poll(async () => scene.getAttribute("data-state"), { timeout: 25_000 })
    .not.toBe("rest");
  await page.keyboard.press("Space");
  const toggle = page.getByRole("button", { name: "Hide orbit" });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await toggle.click();
  await expect(scene).toHaveCount(0);
  await expect(page.locator(".workspace-heading.compact")).toBeVisible();
  await page.reload();
  await page.waitForFunction("!!window.__studioTest");
  await expect(page.locator(".orbit-scene")).toHaveCount(0);
  await page.getByRole("button", { name: "Show orbit" }).click();
  await expect(page.locator(".orbit-scene")).toBeVisible();
  expect(errors).toEqual([]);
});

test("the twin orbit starts hidden on short windows", async ({ page }) => {
  await open(page, 1280, 760);
  await expect(page.locator(".orbit-scene")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Show orbit" })).toBeVisible();
});

test("reduced motion keeps the orbit still during audio and responds to preference changes", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, 1440, 900);
  const canvas = page.locator(".orbit-scene canvas");
  await page.keyboard.press("Space");
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__studioTest.getAudioState().playing),
    )
    .toBe(true);
  // Compare just the artwork, so an accessible playback caption may still change.
  const still = await canvas.screenshot();
  await page.waitForTimeout(400);
  expect((await canvas.screenshot()).equals(still)).toBe(true);

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect
    .poll(async () => (await canvas.screenshot()).equals(still))
    .toBe(false);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect
    .poll(async () => (await canvas.screenshot()).equals(still))
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__studioTest.getAudioState().playing),
    )
    .toBe(true);
  await page.keyboard.press("Space");
});

test("orbit captions fit at narrow widths and after resizing", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("studio.orbit-open", "1"),
  );
  for (const width of [1024, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    if (width === 1024) await page.goto("/");
    const scene = page.locator(".orbit-scene");
    await expect(scene).toBeVisible();
    await expect(scene.locator(".orbit-voice-upper")).toHaveText("Small hours");
    const bounds = (await scene.boundingBox())!;
    for (const selector of [".orbit-overline", "figcaption"]) {
      const caption = (await scene.locator(selector).boundingBox())!;
      expect(caption.x).toBeGreaterThanOrEqual(bounds.x);
      expect(caption.x + caption.width).toBeLessThanOrEqual(
        bounds.x + bounds.width,
      );
      expect(caption.y + caption.height).toBeLessThanOrEqual(
        bounds.y + bounds.height,
      );
    }
    const [upper, lower] = await Promise.all([
      scene.locator(".orbit-voice-upper").boundingBox(),
      scene.locator(".orbit-voice-lower").boundingBox(),
    ]);
    expect(upper!.x + upper!.width).toBeLessThan(lower!.x);
  }
});
