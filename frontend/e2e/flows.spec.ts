import { expect, test } from "@playwright/test";
import { makeEmitter, removeEmitter, signIn } from "./helpers";

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("edit a Mode, then save the Emitter as a version", async ({ page }) => {
  const emitter = await makeEmitter(page, ["Search 1", "Search 2"]);
  await page.goto(`/emitters/${emitter.id}`);
  await expect(page.getByRole("heading", { name: emitter.name })).toBeVisible();

  const start = page.getByRole("button", { name: /Start editing/ });
  if (await start.isVisible()) await start.click();

  await page.getByRole("button", { name: "Actions for Search 1" }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill("Track 1");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Actions for Track 1" })).toBeVisible();

  await page.getByRole("button", { name: "Save version", exact: true }).click();
  const save = page.getByRole("dialog");
  await save.locator("input, textarea").first().fill("Renamed Search 1");
  await save.locator("button.primary").last().click();
  await expect(page.getByText(/Last saved as v1/)).toBeVisible();

  await removeEmitter(page, emitter.id);
});

test("log a test run and open it", async ({ page }) => {
  const emitter = await makeEmitter(page);
  await page.goto(`/emitters/${emitter.id}/tests/new`);
  await page.getByLabel("Title").fill("E2E bench run");
  await page.getByRole("textbox", { name: /^Simulation created/ }).fill("01.10.2026");
  await page.getByLabel(/Received power/i).fill("-40");
  // No SIM Test Lines on a new Emitter, so the run takes an overall result.
  await page.getByRole("combobox", { name: /set it manually/ }).selectOption("Pass");
  await page.getByRole("button", { name: "Log test run" }).click();

  await expect(page).toHaveURL(new RegExp(`/emitters/${emitter.id}/tests/[0-9a-f-]+`));
  await expect(page.getByRole("heading", { name: "E2E bench run" })).toBeVisible();
  await expect(page.getByText("-40 dBFS")).toBeVisible();
  await expect(page.locator(".test-result-badge", { hasText: "Pass" }).first()).toBeVisible();

  await removeEmitter(page, emitter.id);
});

test("pick a style in Settings, kept after a reload", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Your account" }).click();
  await page.getByRole("menuitem", { name: "Settings…" }).click();
  await page.getByRole("radio", { name: /Instrument/ }).check();
  await expect(page.locator("html")).toHaveAttribute("data-style", "instrument");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-style", "instrument");

  // Back to the default, so the next run starts the same.
  await page.getByRole("button", { name: "Your account" }).click();
  await page.getByRole("menuitem", { name: "Settings…" }).click();
  await page.getByRole("radio", { name: /Workbench/ }).check();
  await expect(page.locator("html")).toHaveAttribute("data-style", "workbench");
});
