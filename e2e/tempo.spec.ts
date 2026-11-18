import { test, expect, type Page } from "@playwright/test";

const bpm = (page: Page) =>
  page.evaluate(
    "window.__studioTest.getProject().transport.bpm",
  ) as Promise<number>;

test("the BPM field accepts a typed tempo and keeps it", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.waitForFunction("!!window.__studioTest");
  await expect(page.getByLabel("Project title")).toHaveValue("Sunday, softly");
  const field = page.getByLabel("BPM", { exact: true });
  const start = await bpm(page);
  expect(start).toBe(86);

  // Typing digit by digit: "1" and "12" are on the way to 120 and must not be clamped.
  await field.click();
  await field.press("Control+a");
  await field.pressSequentially("120");
  await expect(field).toHaveValue("120");
  expect(await bpm(page)).toBe(120);
  await field.press("Enter");
  await expect(field).toHaveValue("120");
  expect(await bpm(page)).toBe(120);
  // Typing elsewhere and pressing Space must not change it either.
  await page.locator(".arrangement").click({ position: { x: 5, y: 5 } });
  expect(await bpm(page)).toBe(120);
  await expect(field).toHaveValue("120");

  // One undo step returns to the old tempo, and the field follows.
  await page.getByTitle("Undo · ⌘Z").click();
  expect(await bpm(page)).toBe(start);
  await expect(field).toHaveValue(String(start));

  // Arrow keys step by one.
  await field.click();
  await field.press("ArrowUp");
  expect(await bpm(page)).toBe(start + 1);

  // A value out of range is clamped when you leave the field, not while typing.
  await field.press("Control+a");
  await field.pressSequentially("300");
  await field.press("Tab");
  await expect(field).toHaveValue("240");
  expect(await bpm(page)).toBe(240);

  // Escape abandons the edit, including tempos applied on the way.
  await field.click();
  await field.press("Control+a");
  await field.pressSequentially("95");
  expect(await bpm(page)).toBe(95);
  await field.press("Escape");
  await expect(field).toHaveValue("240");
  expect(await bpm(page)).toBe(240);

  // Clearing the field and leaving restores the tempo instead of jumping to the minimum.
  await field.click();
  await field.press("Control+a");
  await field.press("Backspace");
  await field.press("Tab");
  await expect(field).toHaveValue("240");
  expect(await bpm(page)).toBe(240);

  // The new tempo survives a save and reload.
  await field.click();
  await field.press("Control+a");
  await field.pressSequentially("92");
  await field.press("Enter");
  await page.keyboard.press("Control+s");
  await expect(
    page.getByText("All changes saved", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.waitForFunction("!!window.__studioTest");
  await expect(page.getByLabel("BPM", { exact: true })).toHaveValue("92");
  expect(errors).toEqual([]);
});

test("other number fields can be typed into digit by digit", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.waitForFunction("!!window.__studioTest");
  await expect(page.getByLabel("Project title")).toHaveValue("Sunday, softly");
  const type = async (label: string, text: string) => {
    const field = page.getByLabel(label, { exact: true });
    await field.click();
    await field.press("Control+a");
    await field.pressSequentially(text);
    await field.press("Enter");
    return field;
  };
  // Loop end bar: "1" on the way to "12" used to snap to the loop start + 1.
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(await type("Loop end bar", "12")).toHaveValue("12");
  const transport = (await page.evaluate(
    "window.__studioTest.getProject().transport",
  )) as { loopEnd: number };
  expect(transport.loopEnd).toBe(12 * 1920);
  await page.getByRole("button", { name: "Close dialog" }).click();

  // Math Lab tempo fields.
  await page.getByRole("button", { name: "Math Lab", exact: true }).click();
  await expect(await type("Function BPM", "120")).toHaveValue("120");
  await page.getByRole("tab", { name: "03 Bayesian" }).click();
  await expect(await type("Bayesian BPM", "105")).toHaveValue("105");
  expect(errors).toEqual([]);
});
