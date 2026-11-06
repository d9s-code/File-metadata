import { expect, test, type Page } from "@playwright/test";

export const API_URL = process.env.E2E_API_URL ?? "http://localhost:8000";

export const FIXED_LINE = {
  rf_min_mhz: 2900,
  rf_max_mhz: 3100,
  rf_delta: 0,
  pw_min_us: 0.5,
  pw_max_us: 1,
  pw_delta: 0,
  pri_min_us: 800,
  pri_max_us: 900,
  pri_delta: 0,
  jitter_min_us: 0,
  jitter_max_us: 1,
  rf_range_matching: false,
  pw_range_matching: false,
  pri_range_matching: false,
};

/** Signs in through the login page; skips the test when no account is given. */
export async function signIn(page: Page) {
  const username = process.env.E2E_USERNAME;
  const password = process.env.E2E_PASSWORD;
  test.skip(!username || !password, "Set E2E_USERNAME and E2E_PASSWORD to run the browser tests");
  await page.goto("/login");
  await page.getByLabel("Username").fill(username!);
  await page.getByLabel("Password").fill(password!);
  await page.keyboard.press("Enter");
  await expect(page).not.toHaveURL(/\/login/);
}

/** A call to the API as the signed-in user (its session cookie and CSRF token). */
export async function api<T = unknown>(page: Page, method: string, path: string, body?: unknown): Promise<T> {
  const [status, data] = await page.evaluate(
    async ([url, m, b]) => {
      const csrf = document.cookie.split("; ").find((c) => c.startsWith("csrf_token="))?.split("=")[1];
      const r = await fetch(url as string, {
        method: m as string,
        credentials: "include",
        headers: { "content-type": "application/json", "x-csrf-token": decodeURIComponent(csrf ?? "") },
        body: b ? JSON.stringify(b) : undefined,
      });
      const text = await r.text();
      return [r.status, text ? JSON.parse(text) : null] as const;
    },
    [`${API_URL}${path}`, method, body ?? null] as const,
  );
  expect(status, `${method} ${path}: ${JSON.stringify(data)}`).toBeLessThan(300);
  return data as T;
}

/** A fresh Emitter with one EW Group, one Source and the Modes named. */
export async function makeEmitter(page: Page, modes: string[] = ["Search 1"]) {
  const name = `E2E Radar ${Date.now()}`;
  const emitter = await api<{ id: string }>(page, "POST", "/emitters", { name });
  const group = await api<{ id: string }>(page, "POST", `/emitters/${emitter.id}/ew-groups`, { name: "Search" });
  const source = await api<{ id: string }>(page, "POST", `/emitters/${emitter.id}/sources`, { name: "Datasheet", source_date: "2026-01-01" });
  for (const mode of modes) {
    await api(page, "POST", `/ew-groups/${group.id}/modes`, { source_id: source.id, name: mode, pri_type: "fixed", line: FIXED_LINE });
  }
  return { id: emitter.id, name };
}

/** Deletes what a test made (soft delete, as from the list). */
export async function removeEmitter(page: Page, id: string) {
  await api(page, "DELETE", `/emitters/${id}`).catch(() => undefined);
}
