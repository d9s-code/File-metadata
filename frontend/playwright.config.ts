import { defineConfig, devices } from "@playwright/test";

// Browser tests of whole flows, against a running app: the frontend dev server
// (E2E_BASE_URL, default http://localhost:5173) and its API (E2E_API_URL,
// default http://localhost:8000). Sign in as E2E_USERNAME / E2E_PASSWORD, an
// editor or admin. Each test makes its own Emitter, so any database will do —
// not production. Run: npm run test:e2e (once: npx playwright install chromium).
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5173",
    trace: "off",
    viewport: { width: 1440, height: 900 },
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
});
