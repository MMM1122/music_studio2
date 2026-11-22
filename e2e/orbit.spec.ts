import { test, expect, type Page } from "@playwright/test";

async function open(page: Page) {
  await page.addInitScript(() =>
    localStorage.setItem("studio.orbit-open", "1"),
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.waitForFunction("!!window.__studioTest");
  await expect(page.locator(".orbit-scene")).toBeVisible();
}
const separation = async (page: Page) =>
  Number(await page.locator(".orbit-scene").getAttribute("data-separation"));

test("the binary pair draws together while the music plays and parts when it stops", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await open(page);
  const scene = page.locator(".orbit-scene");
  test.skip(
    (await scene.getAttribute("data-renderer")) !== "webgl",
    "WebGL2 with float render targets is not available in this browser.",
  );
  await page.waitForTimeout(500);
  const resting = await separation(page);
  expect(resting).toBeCloseTo(2.65, 1);
  await page.keyboard.press("Space");
  // The melody enters after the intro; then the pair is drawn inward.
  await expect
    .poll(() => separation(page), { timeout: 40_000, intervals: [500] })
    .toBeLessThan(resting - 0.3);
  await expect(scene).not.toHaveAttribute("data-state", "rest");
  await page.keyboard.press("Space");
  await expect
    .poll(() => separation(page), { timeout: 30_000, intervals: [500] })
    .toBeGreaterThan(resting - 0.05);
  await expect(scene).toHaveAttribute("data-state", "rest");
  expect(errors).toEqual([]);
});

test("without WebGL2 the orbit falls back to the painted galaxies", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    // @ts-expect-error -- narrowing the overloads is not useful in a test stub.
    HTMLCanvasElement.prototype.getContext = function (type, options) {
      if (type === "webgl2") return null;
      return original.call(this, type, options);
    };
  });
  await open(page);
  const scene = page.locator(".orbit-scene");
  await expect(scene).toHaveAttribute("data-renderer", "canvas");
  await page.waitForTimeout(500);
  // Something is drawn: the painted sky and galaxies are not a flat fill.
  const lit = await page.locator(".orbit-scene canvas").evaluate((node) => {
    const canvas = node as HTMLCanvasElement;
    const data = canvas
      .getContext("2d")!
      .getImageData(0, 0, canvas.width, canvas.height).data;
    let bright = 0;
    for (let i = 0; i < data.length; i += 4)
      if (data[i] + data[i + 1] + data[i + 2] > 300) bright++;
    return bright;
  });
  expect(lit).toBeGreaterThan(200);
  await page.keyboard.press("Space");
  await expect
    .poll(async () => scene.getAttribute("data-state"), { timeout: 25_000 })
    .not.toBe("rest");
  await page.keyboard.press("Space");
  expect(errors).toEqual([]);
});
