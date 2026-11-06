import { defineConfig } from "vitest/config";

// Unit tests: plain logic (parsing, formatting, sorting), next to the code as
// *.test.ts. The browser tests of whole flows are Playwright's (e2e/).
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
