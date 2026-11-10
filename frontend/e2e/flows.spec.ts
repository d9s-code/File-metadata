import { expect, test } from "@playwright/test";
import { FIXED_LINE, api, makeEmitter, removeEmitter, signIn } from "./helpers";

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

test("ambiguity check: the verdict, and a suggested edit opens the Mode filled in", async ({ page }) => {
  const emitter = await makeEmitter(page, ["Search 1"]);
  const [group] = await api<{ id: string }[]>(page, "GET", `/emitters/${emitter.id}/ew-groups`);
  const [source] = await api<{ id: string }[]>(page, "GET", `/emitters/${emitter.id}/sources`);
  // Half of Search 1's RF (2,900–3,100) overlaps Search 2's (3,000–3,200); the rest is the same.
  await api(page, "POST", `/ew-groups/${group.id}/modes`, {
    source_id: source.id,
    name: "Search 2",
    pri_type: "fixed",
    line: { ...FIXED_LINE, rf_min_mhz: 3000, rf_max_mhz: 3200 },
  });
  await api(page, "POST", `/emitters/${emitter.id}/versions`, { change_summary: "Two Modes" });

  await page.goto(`/ambiguity/emitter/${emitter.id}`);
  await page.getByRole("button", { name: "Run the check" }).click();
  const detail = page.locator(".amb-detail");
  await expect(detail.getByText("Only RF 50% — the rest overlap fully")).toBeVisible();
  await expect(detail.getByText("To tell them apart")).toBeVisible();

  await detail.getByRole("button", { name: "Edit like this…" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: /Edit Search/ })).toBeVisible();
  // Search 1's max down to Search 2's min (no deltas), or Search 2's min up to Search 1's max.
  const max = await dialog.getByLabel("RF max (MHz)").inputValue();
  const min = await dialog.getByLabel("RF min (MHz)").inputValue();
  expect(max === "3000" || min === "3100", `RF ${min}–${max}`).toBe(true);
  await page.keyboard.press("Escape");

  await removeEmitter(page, emitter.id);
});

test("threat priorities: set one in the overview, and it's on the Emitter", async ({ page }) => {
  const emitter = await makeEmitter(page);
  await api(page, "DELETE", `/emitters/${emitter.id}/checkout`);
  await page.goto("/threat-priorities");
  await page.getByLabel("Find an Emitter, EW Group or Platform").fill(emitter.name);
  const cell = page.getByLabel(`Threat priority of ${emitter.name} › Search`);
  await cell.fill("7");
  await cell.press("Enter");
  await expect(page.getByText(/1 changed\. Now editing: E2E Radar/)).toBeVisible();
  const [group] = await api<{ threat_priority: number | null }[]>(page, "GET", `/emitters/${emitter.id}/ew-groups`);
  expect(group.threat_priority).toBe(7);
  await removeEmitter(page, emitter.id);
});
