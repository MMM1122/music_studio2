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
