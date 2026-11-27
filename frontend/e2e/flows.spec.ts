import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { API_URL, FIXED_LINE, api, makeEmitter, removeEmitter, signIn } from "./helpers";

/** An Emitter's XML export, as base64 (to compare byte for byte, the zip's timestamps aside). */
async function exportXml(page: Page, emitterId: string): Promise<string> {
  return page.evaluate(
    async ([url, id]) => {
      const csrf = document.cookie.split("; ").find((c) => c.startsWith("csrf_token="))?.split("=")[1];
      const r = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", "x-csrf-token": decodeURIComponent(csrf ?? "") },
        body: JSON.stringify({ emitter_ids: [id] }),
      });
      if (!r.ok) throw new Error(`export ${r.status}`);
      const bytes = new Uint8Array(await r.arrayBuffer());
      // The zip's own timestamps (when it was made) blanked: only what's in it is compared.
      for (let i = 0; i + 4 <= bytes.length; i++) {
        if (bytes[i] !== 0x50 || bytes[i + 1] !== 0x4b) continue;
        const at = bytes[i + 2] === 3 && bytes[i + 3] === 4 ? 10 : bytes[i + 2] === 1 && bytes[i + 3] === 2 ? 12 : -1;
        if (at > 0) bytes.fill(0, i + at, i + at + 4);
      }
      let bin = "";
      for (const b of bytes) bin += String.fromCharCode(b);
      return btoa(bin);
    },
    [`${API_URL}/emitters/export/xml`, emitterId] as const,
  );
}

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

test("priorities: set one in the overview, and it's on the Emitter", async ({ page }) => {
  const emitter = await makeEmitter(page);
  await api(page, "DELETE", `/emitters/${emitter.id}/checkout`);
  await page.goto("/priorities");
  await page.getByLabel("Find an Emitter, EW Group or Platform").fill(emitter.name);
  const cell = page.getByLabel(`Priority of ${emitter.name} › Search`);
  await cell.fill("7");
  await cell.press("Enter");
  await expect(page.getByText(/1 changed\. Now editing: E2E Radar/)).toBeVisible();
  const [group] = await api<{ threat_priority: number | null }[]>(page, "GET", `/emitters/${emitter.id}/ew-groups`);
  expect(group.threat_priority).toBe(7);
  await removeEmitter(page, emitter.id);
});

test("Emitters list: sorted by status, and a status hidden from the Status column's right-click menu", async ({ page }) => {
  const emitter = await makeEmitter(page);
  await page.goto("/emitters");
  const statusHeader = page.locator(".emitters-table th", { hasText: /^Status/ });
  await expect(statusHeader).toContainText("▲");
  await page.getByLabel("Filter by name or designation").fill(emitter.name);
  const row = page.getByRole("row", { name: new RegExp(emitter.name) });
  const status = (await row.locator(".status-badge").innerText()).trim();

  await statusHeader.click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Choose statuses to show" });
  await menu.getByRole("menuitemcheckbox", { name: new RegExp(`^${status}`) }).uncheck();
  await expect(row).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /^Statuses: \d+ of \d+/ })).toBeVisible();

  await page.getByRole("button", { name: "Reset" }).click();
  await page.getByLabel("Filter by name or designation").fill(emitter.name);
  await expect(row).toHaveCount(1);
  await removeEmitter(page, emitter.id);
});

test("pages refresh after a change: a new Element shows in Element coverage without reloading", async ({ page }) => {
  const emitter = await makeEmitter(page);
  await page.goto(`/emitters/${emitter.id}?tab=setup`);
  const coverage = page.locator("h2", { hasText: "Element coverage" });
  await expect(coverage).toContainText("nothing to check until the Sources have Elements");

  await page.getByRole("button", { name: "Datasheet", exact: true }).click();
  await page.getByLabel("RF min (MHz)").fill("2950");
  await page.getByLabel("RF max (MHz)").fill("3000");
  await page.getByRole("button", { name: "Add RF" }).click();
  await expect(page.getByRole("status")).toContainText("Added RF 2950–3000 MHz");
  await page.getByRole("button", { name: "Close" }).click();

  // The Mode's RF (FIXED_LINE) covers it — counted with no reload.
  await expect(coverage).toContainText("1 of 1 Elements covered");
  await removeEmitter(page, emitter.id);
});

test("Import JSON shows a preview first, and imports only when asked", async ({ page }) => {
  const emitter = await makeEmitter(page);
  const file = {
    file: "preview-e2e.xml",
    notation: "E2E",
    parametric_sets: [
      {
        set_id: "E2E-SET",
        date_last_updated: "10-06-2015 17:19:28 GMT",
        groups: [
          { type: "sequence", name: "Train", steps: [{ "step-num": "1", "pri-value": { min: "800", max: "800" } }, { "step-num": "2", "pri-value": { min: "900", max: "900" } }] },
          { type: "sequence", name: "Scan only", steps: [{ "step-num": "1", "scan-value": { min: "2", max: "4" } }] },
        ],
      },
    ],
  };
  await page.goto(`/emitters/${emitter.id}?tab=setup`);
  await page.getByRole("button", { name: "More ways to add Sources" }).click();
  await page.getByRole("menuitem", { name: "Import JSON…" }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Select JSON file" }).click();
  await (await chooser).setFiles({ name: "e2e.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(file)) });

  const preview = page.getByLabel("What the import would make");
  await expect(preview).toContainText("would make 1 Source with 0 Elements and 1 sequence");
  await expect(preview).toContainText("Sequence 'Scan only' in 'E2E-SET': no step has an RF, PRI or PW");
  await expect(page.getByRole("row", { name: /E2E-SET/ })).toBeVisible();
  // Nothing saved yet.
  expect(await api<unknown[]>(page, "GET", `/emitters/${emitter.id}/sources`)).toHaveLength(1);

  await page.getByRole("button", { name: "Import 1 Source" }).click();
  await expect(page.getByText("1 thing in the file couldn't be read and was left out:")).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  // The Sources list shows it without reloading.
  await expect(page.getByRole("button", { name: "E2E-SET", exact: true })).toBeVisible();
  await removeEmitter(page, emitter.id);
});

test("a collapsed generation batch shows its lowest and highest RF, PRI and PW", async ({ page }) => {
  const emitter = await makeEmitter(page, []);
  const [group] = await api<{ id: string }[]>(page, "GET", `/emitters/${emitter.id}/ew-groups`);
  const [source] = await api<{ id: string }[]>(page, "GET", `/emitters/${emitter.id}/sources`);
  const add = (body: object) => api<{ id: string }>(page, "POST", `/emitters/${emitter.id}/sources/${source.id}/elements`, body);
  const rf = [await add({ element_type: "rf", value_min: 9000, value_max: 9100 }), await add({ element_type: "rf", value_min: 9400, value_max: 9500 })];
  const pw = [await add({ element_type: "pw", value_min: 0.5, value_max: 1.5 })];
  const pri = [await add({ element_type: "pri", value_min: 200, value_max: 210 }), await add({ element_type: "pri", value_min: 300, value_max: 320 })];
  await api(page, "POST", `/emitters/${emitter.id}/sources/${source.id}/elements/cartesian-product`, {
    ew_group_id: group.id,
    rf_element_ids: rf.map((e) => e.id),
    pw_element_ids: pw.map((e) => e.id),
    pri_element_ids: pri.map((e) => e.id),
    name_prefix: "Sweep",
  });
  await page.evaluate(() => localStorage.setItem("modesCollapseBatches", "true"));
  await page.goto(`/emitters/${emitter.id}`);

  const row = page.locator("tr.batch-summary-row").filter({ hasText: "Sweep — 4 Modes" });
  await expect(row).toBeVisible();
  const cells = await row.locator("td.batch-span").allTextContents();
  for (const v of ["9000", "9500", "200", "320", "0.5", "1.5"]) expect(cells).toContain(v);

  await removeEmitter(page, emitter.id);
});

test("test run results: a long stagger wraps inside its cell, folds, and a bare run says so", async ({ page }) => {
  const emitter = await makeEmitter(page);
  const [mode] = await api<{ id: string }[]>(page, "GET", `/emitters/${emitter.id}/modes`);
  const steps = Array.from({ length: 30 }, (_, i) => 100 + i * 11.25);
  const run = await api<{ id: string }>(page, "POST", `/emitters/${emitter.id}/test-records`, {
    test_type: "simulation",
    simulation_created_date: "2026-10-01",
    title: "Long stagger",
    test_date: "2026-11-01",
    received_power_dbfs: -40,
    mode_results: [
      {
        mode_id: mode.id,
        result: "partial",
        notes: "A note long enough to need the column to itself, so it shows whether the steps run into it.",
        observed_values: [{ rf_mean_mhz: 3000, pw_mean_us: 0.7, pri_type: "stagger", pri_stagger_values_us: steps, frame_time_us: 7893.75 }],
      },
    ],
  });
  await page.goto(`/emitters/${emitter.id}/tests/${run.id}`);
  const cell = page.locator(".run-results-table td").filter({ has: page.locator(".obs-steps") });
  await expect(cell.locator(".obs-steps li")).toHaveCount(12);
  await cell.getByRole("button", { name: "Show all 30 steps" }).click();
  await expect(cell.locator(".obs-steps li")).toHaveCount(30);
  // Every step stays inside the parameters cell — none runs into Notes.
  const box = (await cell.boundingBox())!;
  for (const li of await cell.locator(".obs-steps li").all()) {
    const b = (await li.boundingBox())!;
    expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width + 1);
  }

  const bare = await api<{ id: string }>(page, "POST", `/emitters/${emitter.id}/test-records`, {
    test_type: "simulation",
    simulation_created_date: "2026-10-01",
    title: "Result only",
    test_date: "2026-11-01",
    received_power_dbfs: -40,
    result: "pass",
  });
  await page.goto(`/emitters/${emitter.id}/tests/${bare.id}`);
  await expect(page.getByRole("heading", { name: "Only the overall result was logged" })).toBeVisible();
  await removeEmitter(page, emitter.id);
});

test("statuses: quick ↑/↓ clicks show at once and are saved as one order", async ({ page }) => {
  type Def = { id: string; label: string; entity_type: string };
  const before = (await api<Def[]>(page, "GET", "/statuses")).filter((s) => s.entity_type === "emitter");
  await page.goto("/admin/statuses");
  const rows = page.locator(".admin-statuses tbody tr");
  await expect(rows).toHaveCount(before.length);
  let saves = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/statuses/reorder")) saves++;
  });
  // The first status down three places, quickly.
  for (let i = 0; i < 3; i++) await rows.nth(i).locator('button[aria-label$=" down"]').click();
  await expect(rows.nth(3)).toContainText(before[0].label);
  await expect.poll(() => saves, { timeout: 5000 }).toBe(1);
  await expect
    .poll(async () => (await api<Def[]>(page, "GET", "/statuses")).filter((s) => s.entity_type === "emitter")[3].id)
    .toBe(before[0].id);
  await page.waitForTimeout(800);
  expect(saves).toBe(1);
  // Put it back as it was.
  await api(page, "POST", "/statuses/reorder", { entity_type: "emitter", ids: before.map((s) => s.id) });
});

test("Emitter page: a hidden tab isn't refetched after a change, and is fresh when shown", async ({ page }) => {
  const emitter = await makeEmitter(page);
  const [mode] = await api<{ id: string; ew_group_id: string }[]>(page, "GET", `/emitters/${emitter.id}/modes`);
  await page.goto(`/emitters/${emitter.id}?tab=audit`);
  await expect(page.getByRole("button", { name: "Audit", exact: true })).toHaveClass(/active/);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /^Modes/ }).click();

  let auditFetches = 0;
  page.on("request", (r) => {
    if (r.url().includes("/audit-log?")) auditFetches++;
  });
  const note = `hidden-tab check ${Date.now()}`;
  await api(page, "PATCH", `/ew-groups/${mode.ew_group_id}/modes/${mode.id}`, { notes: note });
  await page.evaluate(() => window.dispatchEvent(new Event("api:data-changed")));
  await page.waitForTimeout(800);
  expect(auditFetches).toBe(0);

  await page.getByRole("button", { name: "Audit", exact: true }).click();
  await expect.poll(() => auditFetches).toBeGreaterThan(0);
  await expect(page.getByRole("row", { name: /Updated Mode 'Search 1' Notes changed/ })).toBeVisible();
  await removeEmitter(page, emitter.id);
});

test("Batch edit marks the selected Modes test-derived", async ({ page }) => {
  const emitter = await makeEmitter(page, ["Search 1", "Search 2"]);
  await api(page, "POST", `/emitters/${emitter.id}/test-records`, {
    test_type: "simulation",
    title: "Range day 5",
    test_date: "2026-10-28",
    simulation_created_date: "2026-10-01",
    received_power_dbfs: -40,
    result: "partial",
  });
  await page.goto(`/emitters/${emitter.id}`);
  await page.getByLabel("Select all").check();
  await page.getByRole("button", { name: "Batch edit" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "Test-derived from Range day 5" }).selectOption("add");
  await expect(dialog.getByText("Test-derived — marking from 1 run")).toBeVisible();
  await dialog.getByRole("button", { name: "Apply to 2 Modes" }).click();
  await expect(dialog).toBeHidden();
  const derived = async () =>
    (await api<{ derived_from_test_records: { title: string }[] }[]>(page, "GET", `/emitters/${emitter.id}/modes`)).map((m) =>
      m.derived_from_test_records.map((r) => r.title),
    );
  await expect.poll(derived).toEqual([["Range day 5"], ["Range day 5"]]);

  // And unmarked again: the run says both are linked, Remove takes the links off.
  await page.getByLabel("Select all").check();
  await page.getByRole("button", { name: "Batch edit" }).click();
  await expect(dialog.getByText("2 of 2 linked")).toBeVisible();
  await dialog.getByRole("combobox", { name: "Test-derived from Range day 5" }).selectOption("remove");
  await dialog.getByRole("button", { name: "Apply to 2 Modes" }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(derived).toEqual([[], []]);
  await removeEmitter(page, emitter.id);
});

test("Platform test: some Emitters transmitting, detection, a mix-up, verdicts", async ({ page }) => {
  // Three Emitters pinned; Alpha and Bravo transmit under the Strategy's dwells, Charlie doesn't.
  const made = [];
  for (const name of ["Alpha", "Bravo", "Charlie"]) {
    const e = await makeEmitter(page, [`${name} search`]);
    await api(page, "POST", `/emitters/${e.id}/versions`, { change_summary: "v1" });
    made.push({ ...e, short: name });
  }
  const platform = await api<{ id: string }>(page, "POST", "/platforms", { name: `PT ${Date.now()}` });
  const versions = await Promise.all(made.map((e) => api<{ id: string }[]>(page, "GET", `/emitters/${e.id}/versions`)));
  for (const [i, e] of made.entries()) {
    await api(page, "POST", `/platforms/${platform.id}/links`, { emitter_id: e.id, emitter_version_id: versions[i][0].id });
  }
  await api(page, "POST", `/platforms/${platform.id}/versions`, { change_summary: "pins" });
  const strategy = await api<{ id: string }>(page, "POST", "/dwell-strategies", { name: "Patrol", platform_id: platform.id });
  await api(page, "PATCH", `/dwell-strategies/${strategy.id}`, {
    dwells: [{ freq_mhz: 2900, dwell_time_ms: 100 }, { freq_mhz: 3000, dwell_time_ms: 150 }],
    save_version: true,
    change_summary: "dwells",
  });

  await page.goto(`/platforms/${platform.id}/tests/new`);
  // The reminder of Emitters being edited sits over the table's first column.
  await page.getByRole("button", { name: "Fold away" }).click({ timeout: 5000 }).catch(() => undefined);
  await page.getByLabel("Title").fill("Two on the air");
  await page.getByLabel(/Received Power/).fill("-40");
  await page.getByLabel("Dwell type").selectOption("strategy");
  const patrol = await page.getByLabel("Dwell Strategy").locator("option", { hasText: "Patrol" }).first().getAttribute("value");
  await page.getByLabel("Dwell Strategy").selectOption(patrol!);

  const row = (name: string) => page.locator("tr").filter({ has: page.getByRole("link", { name: new RegExp(name) }) });
  await row(made[2].name).getByRole("checkbox", { name: /in this run/ }).uncheck();
  for (const e of made.slice(0, 2)) await row(e.name).getByRole("textbox", { name: /simulation created/ }).fill("01.10.2026");
  await row(made[0].name).getByLabel(/detected$/).selectOption("yes");
  await row(made[0].name).getByLabel(/caught by dwell/).selectOption("2");
  await row(made[0].name).getByLabel(/time to detect/).fill("1.5");
  await row(made[1].name).getByLabel(/detected$/).selectOption("yes");
  await row(made[1].name).getByRole("checkbox", { name: "Itself" }).uncheck();
  await row(made[1].name).getByRole("button", { name: /reported as another Emitter/ }).click();
  await page.getByRole("menuitem", { name: new RegExp(made[0].name) }).click();
  await row(made[1].name).getByLabel(/reported as which Mode of/).selectOption("Alpha search");
  await expect(page.locator(".test-run-overall")).toContainText("2 of 3 pinned Emitters transmitting");
  await expect(row(made[1].name).getByLabel(/result$/)).toContainText("Worked out: Fail");

  await page.getByRole("button", { name: /Log Platform test \(2 Emitters\)/ }).click();
  await expect(page).toHaveURL(new RegExp(`/platforms/${platform.id}\\?tab=tests`));
  const [test] = await api<{ id: string; verdicts: { detection: string; mixup_count: number }; emitters: unknown[] }[]>(
    page,
    "GET",
    `/platforms/${platform.id}/tests`,
  );
  expect(test.emitters).toHaveLength(2);
  expect(test.verdicts).toMatchObject({ detection: "pass", mixup_count: 1 });

  await page.goto(`/platforms/${platform.id}/tests/${test.id}`);
  await expect(page.locator(".mixups-list")).toContainText(`${made[1].name} reported as ${made[0].name} — its ? as Alpha search`);
  await expect(page.getByText("Dwell 2 · 3000 MHz")).toBeVisible();
  for (const e of made) await removeEmitter(page, e.id);
});

test("Weekly update: pick what's on the slide, see it, download it as a 16:9 PNG", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Weekly update…" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("checkbox", { name: /Current MDF progress/ })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: /Testing this week/ })).not.toBeChecked();
  await dialog.getByRole("checkbox", { name: /Testing this week/ }).check();
  await dialog.getByLabel("Headline (optional)").fill("All on track.");
  const preview = dialog.locator(".weekly-preview img");
  await expect(preview).toBeVisible();
  // The preview is the slide itself: it carries what was picked and typed.
  await expect.poll(async () => decodeURIComponent((await preview.getAttribute("src")) ?? "")).toContain("All on track.");
  expect(decodeURIComponent((await preview.getAttribute("src")) ?? "")).toContain("Testing this week");
  const [download] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("button", { name: "Download PNG" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^Weekly progress \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}\.png$/);
  const png = await (await download.createReadStream()).toArray();
  const bytes = Buffer.concat(png);
  // PNG header, then the size: 1920 × 1080.
  expect(bytes.subarray(1, 4).toString()).toBe("PNG");
  expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([1920, 1080]);
});

test("Dwell planner: finds the cycle in step with a scan, one click breaks it; dwell times stay whole collects", async ({ page }) => {
  const name = `E2E Planner ${Date.now()}`;
  const e = await api<{ id: string }>(page, "POST", "/emitters", { name });
  const g = await api<{ id: string }>(page, "POST", `/emitters/${e.id}/ew-groups`, { name: "Search", scan_min: 2, scan_max: 2 });
  const s = await api<{ id: string }>(page, "POST", `/emitters/${e.id}/sources`, { name: "S", source_date: "2026-01-01" });
  await api(page, "POST", `/ew-groups/${g.id}/modes`, { source_id: s.id, name: "Search 1", pri_type: "fixed", line: FIXED_LINE });
  const v = await api<{ id: string }>(page, "POST", `/emitters/${e.id}/versions`, { change_summary: "v1" });
  const p = await api<{ id: string }>(page, "POST", "/platforms", { name: `E2E Planner Platform ${Date.now()}` });
  await api(page, "POST", `/platforms/${p.id}/links`, { emitter_id: e.id, emitter_version_id: v.id });
  const st = await api<{ id: string }>(page, "POST", "/dwell-strategies", { name: "Planner", platform_ids: [p.id] });
  // A 1 s cycle against its 2 s scan: the same moments every time.
  await api(page, "PATCH", `/dwell-strategies/${st.id}`, {
    bandwidth_mhz: 200,
    dwells: [
      { freq_mhz: 3000, dwell_time_ms: 100, collect_time_ms: 50 },
      { freq_mhz: 5600, dwell_time_ms: 900, collect_time_ms: 50 },
    ],
    save_version: true,
  });

  await page.goto(`/dwells/strategies/${st.id}`);
  const planner = page.getByRole("region", { name: "Planner" });
  const row = planner.locator("tr", { hasText: name });
  await expect(row).toContainText("Synchronism");
  await planner.getByRole("button", { name: "Break the synchronism" }).click();
  await expect(planner.locator(".planner-message")).toContainText("check the dwells above, then save");
  await expect(row).not.toContainText("Synchronism");
  // The change is one to three whole collects more on one dwell (whichever slides best against the scan) — unsaved, in the table.
  const times = [await page.getByLabel("Dwell 1 dwell time (ms)").inputValue(), await page.getByLabel("Dwell 2 dwell time (ms)").inputValue()];
  const total = times.map(Number).reduce((a, b) => a + b);
  expect([1050, 1100, 1150]).toContain(total);

  // A dwell time that isn't whole collects can't be saved until it's rounded.
  await page.getByLabel("Dwell 1 dwell time (ms)").fill("120");
  await expect(page.locator(".dwell-save-state")).toContainText("isn't a whole number of its 50 ms collects");
  await expect(page.getByRole("button", { name: /^Save as v/ })).toBeDisabled();
  await page.getByRole("button", { name: /Round it up/ }).click();
  await expect(page.getByLabel("Dwell 1 dwell time (ms)")).toHaveValue("150");
  await expect(page.getByRole("button", { name: /^Save as v/ })).toBeEnabled();
  await page.getByRole("button", { name: "Discard" }).click();
  await removeEmitter(page, e.id);
});

test("MDF test with a Dwell Strategy: logged with it, listed on the Strategy; the planner plays a Mode at its own scan", async ({ page }) => {
  const n = Date.now();
  const e = await api<{ id: string }>(page, "POST", "/emitters", { name: `E2E MFR ${n}`, illumination_time_ms: 30 });
  const g = await api<{ id: string }>(page, "POST", `/emitters/${e.id}/ew-groups`, { name: "MFR", scan_min: 1, scan_max: 10 });
  const s = await api<{ id: string }>(page, "POST", `/emitters/${e.id}/sources`, { name: "S", source_date: "2026-01-01" });
  // Its own scan: back every 1–2 s; no illumination time it can work out, so the Emitter's.
  const scan = await api<{ id: string }>(page, "POST", `/emitters/${e.id}/scans`, {
    name: "Horizon box",
    pattern: "other",
    params: { revisit_s: 1.5, revisit_s_delta: 0.5 },
  });
  await api(page, "POST", `/ew-groups/${g.id}/modes`, { source_id: s.id, name: "Horizon", pri_type: "fixed", line: FIXED_LINE, scan_id: scan.id });
  const v = await api<{ id: string }>(page, "POST", `/emitters/${e.id}/versions`, { change_summary: "v1" });
  const p = await api<{ id: string }>(page, "POST", "/platforms", { name: `E2E MFR Platform ${n}` });
  await api(page, "POST", `/platforms/${p.id}/links`, { emitter_id: e.id, emitter_version_id: v.id });
  const pv = await api<{ id: string }>(page, "POST", `/platforms/${p.id}/versions`, { change_summary: "v1" });
  const strategy = `E2E Sweep ${n}`;
  const st = await api<{ id: string }>(page, "POST", "/dwell-strategies", { name: strategy, platform_ids: [p.id] });
  await api(page, "PATCH", `/dwell-strategies/${st.id}`, {
    bandwidth_mhz: 200,
    dwells: [{ freq_mhz: 3000, dwell_time_ms: 100, collect_time_ms: 50 }],
    save_version: true,
  });
  const mdf = await api<{ id: string }>(page, "POST", "/mdfs", { name: `E2E Fleet ${n}` });
  await api(page, "POST", `/mdfs/${mdf.id}/links`, { platform_id: p.id, platform_version_id: pv.id });
  await api(page, "POST", `/mdfs/${mdf.id}/versions`, { change_summary: "v1" });

  // The planner: its scan's 1–2 s, and the Emitter's illumination time.
  await page.goto(`/dwells/strategies/${st.id}`);
  const row = page.getByRole("region", { name: "Planner" }).locator("tr", { hasText: `E2E MFR ${n}` });
  await expect(row).toContainText("Horizon box 1–2 s");
  await expect(row).toContainText("Emitter's");

  // The MDF test, logged with the Strategy.
  await page.goto(`/mdfs/${mdf.id}?tab=tests`);
  await page.getByRole("button", { name: "+ Add test run" }).click();
  const form = page.locator("form.card");
  await form.getByPlaceholder("Title").fill("Sweep run");
  await form.getByLabel(/Simulation created/).fill("2026-11-20");
  await form.getByLabel(/Received power/i).fill("-40");
  const kind = form.locator("select").filter({ has: page.locator("option", { hasText: "Strategy…" }) });
  await kind.selectOption({ label: "Strategy…" });
  const pick = form.locator("select").filter({ has: page.locator("option", { hasText: strategy }) });
  await pick.selectOption({ label: (await pick.locator("option", { hasText: strategy }).innerText()).trim() });
  await page.getByRole("button", { name: "Log Test" }).click();
  await expect(page.getByRole("link", { name: strategy })).toBeVisible();

  // …and on the Strategy's page, back to the run.
  await page.goto(`/dwells/strategies/${st.id}`);
  await page.getByRole("button", { name: /^Used in/ }).click();
  await expect(page.getByRole("link", { name: "Sweep run" })).toBeVisible();
  await expect(page.getByText("· MDF test")).toBeVisible();
  await page.getByRole("link", { name: "Sweep run" }).click();
  await expect(page).toHaveURL(/tab=tests&testRecord=/);
  await removeEmitter(page, e.id);
});

test("Scans: one added with its pattern, worked out and drawn; an operational mode uses it, its Mode takes it, the planner too", async ({ page }) => {
  const n = Date.now();
  const name = `E2E Radar ${n}`;
  const e = await api<{ id: string }>(page, "POST", "/emitters", { name, illumination_time_ms: 20 });
  const g = await api<{ id: string }>(page, "POST", `/emitters/${e.id}/ew-groups`, { name: "All", scan_min: 2, scan_max: 2 });
  const s = await api<{ id: string }>(page, "POST", `/emitters/${e.id}/sources`, { name: "S", source_date: "2026-01-01" });
  await api(page, "POST", `/ew-groups/${g.id}/modes`, { source_id: s.id, name: "Search 1", pri_type: "fixed", line: FIXED_LINE });

  await page.goto(`/emitters/${e.id}?tab=operational`);
  const start = page.getByRole("button", { name: /Start editing/ });
  if (await start.isVisible()) await start.click();
  // A circular scan: 1.8° of a 10 s turn is 50 ms, worked out as it's typed, with its pictures.
  await page.getByRole("button", { name: "+ Add scan" }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Name").fill("Surveillance");
  await form.getByLabel("Scan pattern").selectOption("circular");
  await form.getByLabel("Rotation period", { exact: true }).fill("10");
  await form.getByLabel("Beamwidth, azimuth (°)").fill("1.8");
  await expect(form).toContainText("1.8° ÷ 360° × 10 s = 50 ms");
  await expect(form.getByRole("img", { name: "Circular pattern" })).toBeVisible();
  await expect(form.getByRole("img", { name: /over three revisits/ })).toBeVisible();
  await form.getByRole("button", { name: "Add", exact: true }).click();
  await expect(form).toBeHidden();
  await expect(page.locator(".scans-table tr", { hasText: "Surveillance" })).toContainText("50 ms");

  const card = page.getByRole("region", { name: "Operational modes" });
  await card.getByRole("button", { name: "+ Add operational mode" }).click();
  const add = page.getByRole("dialog");
  await add.getByLabel("Name").fill("Volume search");
  await add.getByLabel("Scan").selectOption({ label: "Surveillance (Circular)" });
  await add.getByRole("button", { name: "Add", exact: true }).click();
  await expect(card.locator("tr", { hasText: "Volume search" })).toContainText("Surveillance · 50 ms, every 10 s");

  // Linked from the Mode's More options.
  await page.goto(`/emitters/${e.id}?tab=modes`);
  await page.getByRole("button", { name: "Actions for Search 1" }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /More options/ }).click();
  await dialog.getByLabel("Operational mode").selectOption({ label: "Volume search (Surveillance)" });
  await expect(dialog).toContainText("Illumination time: 50 ms, from Surveillance");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();

  // Saved and pinned, the planner gives the Mode its scan's 50 ms.
  const v = await api<{ id: string }>(page, "POST", `/emitters/${e.id}/versions`, { change_summary: "v1" });
  const p = await api<{ id: string }>(page, "POST", "/platforms", { name: `E2E Radar Platform ${n}` });
  await api(page, "POST", `/platforms/${p.id}/links`, { emitter_id: e.id, emitter_version_id: v.id });
  const st = await api<{ id: string }>(page, "POST", "/dwell-strategies", { name: `E2E OM ${n}`, platform_ids: [p.id] });
  await api(page, "PATCH", `/dwell-strategies/${st.id}`, {
    bandwidth_mhz: 200,
    dwells: [{ freq_mhz: 3000, dwell_time_ms: 100, collect_time_ms: 50 }],
    save_version: true,
  });
  await page.goto(`/dwells/strategies/${st.id}`);
  const row = page.getByRole("region", { name: "Planner" }).locator("tr", { hasText: name });
  await expect(row).toContainText("50 ms");
  await expect(row).toContainText("Surveillance");
  await removeEmitter(page, e.id);
});

test("Operational modes as a tree: TRACK holds Track 1 and 2, shows what they share, sets it on them, takes in a Mode", async ({ page }) => {
  const n = Date.now();
  const e = await api<{ id: string }>(page, "POST", "/emitters", { name: `E2E Tree ${n}` });
  const g = await api<{ id: string }>(page, "POST", `/emitters/${e.id}/ew-groups`, { name: "All" });
  const s = await api<{ id: string }>(page, "POST", `/emitters/${e.id}/sources`, { name: "S", source_date: "2026-01-01" });
  const url = `/emitters/${e.id}/operational-modes`;
  const scan = (name: string, params: Record<string, number>) =>
    api<{ id: string }>(page, "POST", `/emitters/${e.id}/scans`, { name, pattern: "esa", params });
  const dwell = await scan("Track dwell", { pulses: 16, revisit_s: 0.5 });
  await scan("Fast dwell", { dwell_ms: 2, revisit_s: 0.1 });
  const track = await api<{ id: string }>(page, "POST", url, { name: "TRACK", scan_id: dwell.id });
  const t1 = await api<{ id: string }>(page, "POST", url, { name: "Track 1", parent_id: track.id });
  const line = (pri: number) => ({ ...FIXED_LINE, rf_min_mhz: 9400, rf_max_mhz: 9450, pri_min_us: pri, pri_max_us: pri });
  await api(page, "POST", `/ew-groups/${g.id}/modes`, { source_id: s.id, name: "T1", pri_type: "fixed", line: line(100), operational_mode_id: t1.id });
  await api(page, "POST", `/ew-groups/${g.id}/modes`, { source_id: s.id, name: "T2", pri_type: "fixed", line: line(120) });

  await page.goto(`/emitters/${e.id}?tab=operational`);
  const start = page.getByRole("button", { name: /Start editing/ });
  if (await start.isVisible()) await start.click();
  const card = page.getByRole("region", { name: "Operational modes" });

  // Track 2, added under TRACK from its menu.
  await card.getByRole("button", { name: "Actions for TRACK", exact: true }).click();
  await page.getByRole("menuitem", { name: "Add under it…" }).click();
  const add = page.getByRole("dialog");
  await add.getByLabel("Name").fill("Track 2");
  await add.getByRole("button", { name: "Add", exact: true }).click();
  await expect(add).toBeHidden();

  // T2 isn't in one yet: moved under Track 2.
  // (Clicked as such: the floating "Editing n Emitters" box may sit over the table's corner.)
  await card.getByLabel("Select T2").dispatchEvent("click");
  await expect(card.getByLabel("Select T2")).toBeChecked();
  await card.locator(".op-move-bar select").selectOption({ label: "\u2003Track 2" });
  await card.getByRole("button", { name: "Move", exact: true }).click();
  const trackRow = card.locator("tr", { has: page.getByText("TRACK", { exact: true }) });
  // The RF range both share shows once, on TRACK; their PRIs on Track 1 and 2.
  await expect(trackRow).toContainText("9400–9450 MHz");
  await expect(card.locator("tr", { has: page.getByText("Track 2", { exact: true }) })).toContainText("120 µs");
  await expect(card.locator("tr", { has: page.getByText("Track 2", { exact: true }) })).toContainText("from TRACK");

  // Set on both from TRACK: a new RF max.
  await card.getByRole("button", { name: "Actions for TRACK", exact: true }).click();
  await page.getByRole("menuitem", { name: /Set on its 2 Modes/ }).click();
  const set = page.getByRole("dialog");
  await set.getByLabel("RF max").fill("9460");
  await set.getByRole("button", { name: "Set 1 value" }).click();
  await expect(set).toBeHidden();
  await expect(trackRow).toContainText("9400–9460 MHz");

  // TRACK's scan changed: Track 2 takes the new one.
  await card.getByRole("button", { name: "Actions for TRACK", exact: true }).click();
  await page.getByRole("menuitem", { name: "Edit…" }).click();
  const edit = page.getByRole("dialog");
  await edit.getByLabel("Scan").selectOption({ label: "Fast dwell (Electronic (ESA) dwell)" });
  await edit.getByRole("button", { name: "Save", exact: true }).click();
  await expect(edit).toBeHidden();
  const track2 = card.locator("tr", { has: page.getByText("Track 2", { exact: true }) });
  await expect(track2).toContainText("Fast dwell · 2 ms, every 0.1 s");
  await expect(track2).toContainText("from TRACK");

  // Track 2 moved up, above Track 1.
  await card.getByRole("button", { name: "Actions for Track 2", exact: true }).click();
  await page.getByRole("menuitem", { name: "Move up" }).click();
  const names = card.locator("tr.op-node-row strong");
  await expect(names).toHaveText(["TRACK", "Track 2", "Track 1"]);
  await removeEmitter(page, e.id);
});

test("Plan: an operational mode's planned values, what its Modes don't cover, the missing ones made, a comment", async ({ page }) => {
  const n = Date.now();
  const e = await api<{ id: string }>(page, "POST", "/emitters", { name: `E2E Plan ${n}` });
  const g = await api<{ id: string }>(page, "POST", `/emitters/${e.id}/ew-groups`, { name: "All" });
  const s = await api<{ id: string }>(page, "POST", `/emitters/${e.id}/sources`, { name: "S", source_date: "2026-01-01" });
  const track = await api<{ id: string }>(page, "POST", `/emitters/${e.id}/operational-modes`, { name: "TRACK" });
  const line = { ...FIXED_LINE, rf_min_mhz: 9400, rf_max_mhz: 9450, pri_min_us: 100, pri_max_us: 100, pw_min_us: 1, pw_max_us: 1 };
  await api(page, "POST", `/ew-groups/${g.id}/modes`, { source_id: s.id, name: "T1", pri_type: "fixed", line, operational_mode_id: track.id });

  await page.goto(`/emitters/${e.id}?tab=operational`);
  const start = page.getByRole("button", { name: /Start editing/ });
  if (await start.isVisible()) await start.click();
  const card = page.getByRole("region", { name: "Operational modes" });

  // Plan it: RF 9400–9450, a dwell & switch of 100 and 120 µs, PW 1 µs.
  await card.getByRole("button", { name: "Actions for TRACK", exact: true }).click();
  await page.getByRole("menuitem", { name: /^Edit/ }).click();
  const edit = page.getByRole("dialog");
  await edit.getByRole("button", { name: "+ RF value" }).click();
  await edit.getByLabel("RF 1 min").fill("9400");
  await edit.getByLabel("RF 1 max").fill("9450");
  await edit.getByLabel("PRI as").selectOption("dwell");
  for (const [i, pri] of [[1, "100"], [2, "120"]] as const) {
    await edit.getByRole("button", { name: "+ PRI value" }).click();
    await edit.getByLabel(`PRI ${i} min`).fill(pri);
  }
  await edit.getByLabel("PRI 1 dwell", { exact: true }).fill("64");
  await edit.getByLabel("PRI 2 note").fill("Seen once — confirm");
  await edit.getByRole("button", { name: "+ PW value" }).click();
  await edit.getByLabel("PW 1 min").fill("1");
  await edit.getByRole("button", { name: "Save", exact: true }).click();
  await expect(edit).toBeHidden();

  // 120 µs isn't covered by a Mode: flagged.
  await expect(card).toContainText("Plan: 2 combinations across 1 operational mode — 1 not covered by a Mode");
  const trackRow = card.locator("tr", { has: page.getByText("TRACK", { exact: true }) });
  await expect(trackRow.locator(".op-planned.uncovered")).toContainText("120 µs");

  // Set on its Modes: from the plan, the one missing is made.
  await card.getByRole("button", { name: "Actions for TRACK", exact: true }).click();
  await page.getByRole("menuitem", { name: /Set on its/ }).click();
  const set = page.getByRole("dialog");
  await set.getByRole("button", { name: "Fill in from its plan" }).click();
  await set.getByLabel("EW Group").selectOption({ label: "All" });
  await set.getByLabel("Source").selectOption({ label: "S" });
  await set.getByRole("button", { name: "Create 1 Mode" }).click();
  await expect(set).toBeHidden();
  await expect(card).toContainText("all covered");

  // A question on TRACK, resolved.
  await card.getByRole("button", { name: /^Comments on TRACK/ }).click();
  const thread = page.getByRole("dialog");
  await thread.getByLabel("New comment").fill("Is 120 µs real?");
  await thread.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(thread).toContainText("Is 120 µs real?");
  await thread.getByRole("button", { name: "Resolve" }).click();
  await expect(thread).toContainText("Resolved");
  await removeEmitter(page, e.id);
});

test("Operational modes as containers: boxes in boxes, a Mode dragged into another", async ({ page }) => {
  const n = Date.now();
  const e = await api<{ id: string }>(page, "POST", "/emitters", { name: `E2E Boxes ${n}` });
  const g = await api<{ id: string }>(page, "POST", `/emitters/${e.id}/ew-groups`, { name: "All" });
  const s = await api<{ id: string }>(page, "POST", `/emitters/${e.id}/sources`, { name: "S", source_date: "2026-01-01" });
  const url = `/emitters/${e.id}/operational-modes`;
  const track = await api<{ id: string }>(page, "POST", url, { name: "TRACK" });
  await api(page, "POST", url, { name: "Track 1", parent_id: track.id });
  await api(page, "POST", `/ew-groups/${g.id}/modes`, { source_id: s.id, name: "Loose", pri_type: "fixed", line: FIXED_LINE });

  await page.goto(`/emitters/${e.id}?tab=operational`);
  const start = page.getByRole("button", { name: /Start editing/ });
  if (await start.isVisible()) await start.click();
  const card = page.getByRole("region", { name: "Operational modes" });
  await card.getByRole("button", { name: "Containers" }).click();
  const outer = card.getByRole("group", { name: "Operational mode TRACK", exact: true });
  const inner = outer.getByRole("group", { name: "Operational mode TRACK › Track 1" });
  await expect(inner).toBeVisible();
  await expect(card.getByRole("group", { name: "Not in an operational mode" })).toContainText("Loose");

  await card.locator(".op-chip", { hasText: "Loose" }).dragTo(inner);
  await expect(inner.locator(".op-chip", { hasText: "Loose" })).toBeVisible();
  await expect(outer).toContainText("1 Mode");
  // The choice is remembered.
  await page.reload();
  await expect(page.getByRole("region", { name: "Operational modes" }).locator(".op-boxes")).toBeVisible();
  await removeEmitter(page, e.id);
});

test("Plan staggers and PW paired with PRI: a stagger from another step covers only with range matching; a Stagger Mode made", async ({ page }) => {
  const n = Date.now();
  const e = await api<{ id: string }>(page, "POST", "/emitters", { name: `E2E Stagger ${n}` });
  const g = await api<{ id: string }>(page, "POST", `/emitters/${e.id}/ew-groups`, { name: "All" });
  const s = await api<{ id: string }>(page, "POST", `/emitters/${e.id}/sources`, { name: "S", source_date: "2026-01-01" });
  const burst = await api<{ id: string }>(page, "POST", `/emitters/${e.id}/operational-modes`, { name: "BURST" });
  const line = { ...FIXED_LINE, rf_min_mhz: 9600, rf_max_mhz: 9650, pw_min_us: 1, pw_max_us: 2 };
  const stagger = Object.fromEntries(Object.entries(line).filter(([k]) => !k.startsWith("pri_") && !k.startsWith("jitter_")));
  const b1 = await api<{ id: string }>(page, "POST", `/ew-groups/${g.id}/modes`, {
    source_id: s.id, name: "B1", pri_type: "stagger", operational_mode_id: burst.id,
    line: { ...stagger, pri_range_matching: false, pri_stagger_values_us: [400, 500, 300], frame_time_delta_us: 2 },
  });  // prettier-ignore

  await page.goto(`/emitters/${e.id}?tab=operational`);
  const start = page.getByRole("button", { name: /Start editing/ });
  if (await start.isVisible()) await start.click();
  const card = page.getByRole("region", { name: "Operational modes" });
  if (await card.getByRole("button", { name: "Table" }).isVisible()) await card.getByRole("button", { name: "Table" }).click();

  // Plan a stagger with a PW per step, in the editor.
  await card.getByRole("button", { name: "Actions for BURST", exact: true }).click();
  await page.getByRole("menuitem", { name: /^Edit/ }).click();
  const edit = page.getByRole("dialog");
  await edit.getByRole("button", { name: "+ RF value" }).click();
  await edit.getByLabel("RF 1 min").fill("9600");
  await edit.getByLabel("RF 1 max").fill("9650");
  await edit.getByLabel("PRI as").selectOption("stagger");
  await edit.getByLabel("PW goes with each PRI (pulse to pulse)").check();
  for (const [i, steps, pws] of [[1, "300/400/500", "1/2/1"], [2, "250/350", "1/1"]] as const) {
    await edit.getByRole("button", { name: "+ stagger" }).click();
    await edit.getByLabel(`Stagger ${i} steps`).fill(steps);
    await edit.getByLabel(`Stagger ${i} PW per step`).fill(pws);
  }
  await edit.getByRole("button", { name: "Save", exact: true }).click();
  await expect(edit).toBeHidden();

  // B1 starts from another step, without range matching: not covering it.
  const row = card.locator("tr", { has: page.getByText("BURST", { exact: true }) });
  await expect(row.locator(".op-planned.uncovered")).toHaveCount(2);
  // With range matching on, it does.
  await api(page, "PATCH", `/ew-groups/${g.id}/modes/${b1.id}`, {
    pri_type: "stagger",
    line: { ...stagger, pri_range_matching: true, pri_stagger_values_us: [400, 500, 300], frame_time_delta_us: 2 },
  });
  await page.reload();
  const row2 = page.getByRole("region", { name: "Operational modes" }).locator("tr", { has: page.getByText("BURST", { exact: true }) });
  await expect(row2.locator(".op-planned.covered", { hasText: "300/400/500" })).toBeVisible();

  // The other stagger, made as a Stagger Mode from the plan.
  const card2 = page.getByRole("region", { name: "Operational modes" });
  await card2.getByRole("button", { name: "Actions for BURST", exact: true }).click();
  await page.getByRole("menuitem", { name: /Set on its/ }).click();
  const set = page.getByRole("dialog");
  await set.getByRole("button", { name: "Fill in from its plan" }).click();
  await set.getByLabel("EW Group").selectOption({ label: "All" });
  await set.getByLabel("Source").selectOption({ label: "S" });
  await set.getByRole("button", { name: "Create 1 Mode" }).click();
  await expect(set).toBeHidden();
  const modes = await api<{ name: string; pri_type: string; line: { pri_stagger_values_us: number[] } }[]>(page, "GET", `/ew-groups/${g.id}/modes`);
  const made = modes.find((m) => m.name === "BURST 1")!;
  expect([made.pri_type, made.line.pri_stagger_values_us]).toEqual(["stagger", [250, 350]]);
  await removeEmitter(page, e.id);
});

test("Pulse groups and timelines: a Mode in groups drawn, an operational mode's timeline drawn, the planner's timeline per Mode", async ({ page }) => {
  const n = Date.now();
  const name = `E2E Burst ${n}`;
  const e = await api<{ id: string }>(page, "POST", "/emitters", { name });
  const g = await api<{ id: string }>(page, "POST", `/emitters/${e.id}/ew-groups`, { name: "All", scan_min: 1, scan_max: 1 });
  const s = await api<{ id: string }>(page, "POST", `/emitters/${e.id}/sources`, { name: "S", source_date: "2026-01-01" });
  const a = await api<{ id: string }>(page, "POST", `/ew-groups/${g.id}/modes`, { source_id: s.id, name: "PRF A", pri_type: "fixed", line: FIXED_LINE });
  await api(page, "POST", `/ew-groups/${g.id}/modes`, { source_id: s.id, name: "PRF B", pri_type: "fixed", line: FIXED_LINE });

  // A Mode's pulse groups, from More options: drawn under its line.
  await page.goto(`/emitters/${e.id}?tab=modes`);
  const start = page.getByRole("button", { name: /Start editing/ });
  if (await start.isVisible()) await start.click();
  await page.getByRole("button", { name: "Actions for PRF B" }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("img", { name: "The Mode's pulse train" })).toBeVisible();
  await dialog.getByRole("button", { name: /More options/ }).click();
  await dialog.getByLabel("Pulses in a group").fill("8");
  await dialog.getByLabel("Then off (ms)").fill("5");
  await expect(dialog).toContainText("groups of 8, off 5 ms");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();

  // An operational mode's timeline: PRF A for 8 pulses, then off 2 ms.
  await page.goto(`/emitters/${e.id}?tab=operational`);
  const card = page.getByRole("region", { name: "Operational modes" });
  await card.getByRole("button", { name: "+ Add operational mode" }).click();
  const add = page.getByRole("dialog");
  await add.getByLabel("Name").fill("TRACK");
  await add.getByRole("button", { name: "+ Pulse group" }).click();
  await add.getByLabel("Step 1 Mode").selectOption({ label: "PRF A" });
  await add.getByLabel("Step 1 pulses").fill("8");
  await add.getByRole("button", { name: "+ Off time" }).click();
  await add.getByLabel("Step 2 ms").fill("2");
  await expect(add.getByRole("img", { name: "The operational mode's timeline" })).toBeVisible();
  await add.getByRole("button", { name: "Add", exact: true }).click();
  await expect(add).toBeHidden();
  await expect(card.locator("tr", { hasText: "TRACK" })).toContainText("timeline of 2 steps");
  const op = (await api<{ id: string; name: string }[]>(page, "GET", `/emitters/${e.id}/operational-modes`))[0];
  await api(page, "PATCH", `/ew-groups/${g.id}/modes/${a.id}`, { operational_mode_id: op.id });

  // The planner: PRF A in TRACK's timeline; its timeline against the cycle opens under it.
  const v = await api<{ id: string }>(page, "POST", `/emitters/${e.id}/versions`, { change_summary: "v1" });
  const p = await api<{ id: string }>(page, "POST", "/platforms", { name: `E2E Burst Platform ${n}` });
  await api(page, "POST", `/platforms/${p.id}/links`, { emitter_id: e.id, emitter_version_id: v.id });
  const st = await api<{ id: string }>(page, "POST", "/dwell-strategies", { name: `E2E Burst ${n}`, platform_ids: [p.id] });
  await api(page, "PATCH", `/dwell-strategies/${st.id}`, { bandwidth_mhz: 200, dwells: [{ freq_mhz: 3000, dwell_time_ms: 100, collect_time_ms: 50 }], save_version: true });
  await page.goto(`/dwells/strategies/${st.id}`);
  const row = page.getByRole("region", { name: "Planner" }).locator("tr", { hasText: "PRF A" });
  await expect(row).toContainText("in TRACK's timeline");
  await row.getByRole("button", { name: "Show PRF A's timeline" }).click();
  await expect(page.getByRole("img", { name: "PRF A against the dwell cycle over time" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Planner" }).locator("tr", { hasText: "PRF B" })).toContainText("in pulse groups");
  await removeEmitter(page, e.id);
});

test("Signal behaviour: a hopping, sliding, chirped Mode drawn and saved; an EW Group's ERP — none of it exported", async ({ page }) => {
  const n = Date.now();
  const e = await api<{ id: string }>(page, "POST", "/emitters", { name: `E2E Agile ${n}` });
  const g = await api<{ id: string }>(page, "POST", `/emitters/${e.id}/ew-groups`, { name: "Track", scan_min: 1, scan_max: 2 });
  const s = await api<{ id: string }>(page, "POST", `/emitters/${e.id}/sources`, { name: "S", source_date: "2026-01-01" });
  await api(page, "POST", `/ew-groups/${g.id}/modes`, { source_id: s.id, name: "Track hop", pri_type: "fixed", line: FIXED_LINE });
  const before = await exportXml(page, e.id);

  await page.goto(`/emitters/${e.id}?tab=modes`);
  const start = page.getByRole("button", { name: /Start editing/ });
  if (await start.isVisible()) await start.click();
  await page.getByRole("button", { name: "Actions for Track hop" }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /Signal behaviour/ }).click();
  await dialog.getByLabel("RF behaviour").selectOption("hopping");
  await dialog.getByLabel("Channels (MHz)").fill("2950, 3000, 3050");
  await dialog.getByLabel("Hop length").fill("8");
  await dialog.getByLabel("PRI behaviour").selectOption("sliding");
  await dialog.getByLabel("PRI period (ms)").fill("10");
  await dialog.getByLabel("Intra-pulse modulation").selectOption("lfm");
  await dialog.getByLabel("Chirp bandwidth (MHz)").fill("5");
  await expect(dialog.getByRole("img", { name: /RF over time — hopping/ })).toBeVisible();
  await expect(dialog.getByRole("img", { name: /linear chirp over 5 MHz/ })).toBeVisible();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
  const [mode] = await api<{ signal: { rf: { kind: string }; modulation: { bandwidth_mhz: number } } }[]>(page, "GET", `/ew-groups/${g.id}/modes`);
  expect([mode.signal.rf.kind, mode.signal.modulation.bandwidth_mhz]).toEqual(["hopping", 5]);

  // ERP on the EW Group.
  await api(page, "PATCH", `/emitters/${e.id}/ew-groups/${g.id}`, { erp_min_dbm: 70, erp_max_dbm: 85 });
  await page.goto(`/emitters/${e.id}?tab=setup`);
  await expect(page.locator("tr", { hasText: "Track" }).first()).toContainText("70–85");

  // The export is byte for byte what it was.
  expect(await exportXml(page, e.id)).toBe(before);
  await removeEmitter(page, e.id);
});
