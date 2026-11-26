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
  // The change is a whole collect more on one dwell — unsaved, in the table.
  const times = [await page.getByLabel("Dwell 1 dwell time (ms)").inputValue(), await page.getByLabel("Dwell 2 dwell time (ms)").inputValue()];
  expect(times.map(Number).reduce((a, b) => a + b)).toBe(1050);

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

test("MDF test with a Dwell Strategy: logged with it, listed on the Strategy; the planner plays a Mode at its own scan box", async ({ page }) => {
  const n = Date.now();
  const e = await api<{ id: string }>(page, "POST", "/emitters", { name: `E2E MFR ${n}`, illumination_time_ms: 30 });
  const g = await api<{ id: string }>(page, "POST", `/emitters/${e.id}/ew-groups`, { name: "MFR", scan_min: 1, scan_max: 10 });
  const s = await api<{ id: string }>(page, "POST", `/emitters/${e.id}/sources`, { name: "S", source_date: "2026-01-01" });
  await api(page, "POST", `/ew-groups/${g.id}/modes`, { source_id: s.id, name: "Horizon", pri_type: "fixed", line: FIXED_LINE, scan_min_s: 1, scan_max_s: 2 });
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

  // The planner: the Mode's own 1–2 s box, and the Emitter's illumination time.
  await page.goto(`/dwells/strategies/${st.id}`);
  const row = page.getByRole("region", { name: "Planner" }).locator("tr", { hasText: `E2E MFR ${n}` });
  await expect(row).toContainText("Mode's 1–2 s");
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

test("Operational modes: add one, link a Mode to it, and the planner takes its illumination time", async ({ page }) => {
  const n = Date.now();
  const name = `E2E Radar ${n}`;
  const e = await api<{ id: string }>(page, "POST", "/emitters", { name, illumination_time_ms: 20 });
  const g = await api<{ id: string }>(page, "POST", `/emitters/${e.id}/ew-groups`, { name: "All", scan_min: 2, scan_max: 2 });
  const s = await api<{ id: string }>(page, "POST", `/emitters/${e.id}/sources`, { name: "S", source_date: "2026-01-01" });
  await api(page, "POST", `/ew-groups/${g.id}/modes`, { source_id: s.id, name: "Search 1", pri_type: "fixed", line: FIXED_LINE });

  await page.goto(`/emitters/${e.id}?tab=operational`);
  const start = page.getByRole("button", { name: /Start editing/ });
  if (await start.isVisible()) await start.click();
  const card = page.getByRole("region", { name: "Operational modes" });
  await card.getByRole("button", { name: "+ Add operational mode" }).click();
  const add = page.getByRole("dialog");
  await add.getByLabel("Name").fill("Volume search");
  await add.getByLabel("Illumination time (ms)").fill("45");
  await add.getByRole("button", { name: "Add", exact: true }).click();
  await expect(card.locator("tr", { hasText: "Volume search" })).toContainText("45 ms");

  // Linked from the Mode's More options.
  await page.goto(`/emitters/${e.id}?tab=modes`);
  await page.getByRole("button", { name: "Actions for Search 1" }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /More options/ }).click();
  await dialog.getByLabel("Operational mode").selectOption({ label: "Volume search (45 ms)" });
  await expect(dialog).toContainText("Illumination time: 45 ms, from Volume search");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();

  // Saved and pinned, the planner gives the Mode its operational mode's 45 ms.
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
  await expect(row).toContainText("45 ms");
  await expect(row).toContainText("Volume search");
  await removeEmitter(page, e.id);
});

test("Operational modes as a tree: TRACK holds Track 1 and 2, shows what they share, sets it on them, takes in a Mode", async ({ page }) => {
  const n = Date.now();
  const e = await api<{ id: string }>(page, "POST", "/emitters", { name: `E2E Tree ${n}` });
  const g = await api<{ id: string }>(page, "POST", `/emitters/${e.id}/ew-groups`, { name: "All" });
  const s = await api<{ id: string }>(page, "POST", `/emitters/${e.id}/sources`, { name: "S", source_date: "2026-01-01" });
  const url = `/emitters/${e.id}/operational-modes`;
  const track = await api<{ id: string }>(page, "POST", url, { name: "TRACK", illumination_time_ms: 30 });
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
  await removeEmitter(page, e.id);
});
