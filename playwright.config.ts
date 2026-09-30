import { defineConfig } from "@playwright/test";

/** Set E2E_BASE_URL to point the same specs at the deployed GitHub Pages app. */
const base = process.env.E2E_BASE_URL ?? "";
const local = base === "";

export default defineConfig({
    testDir: "./e2e",
    // A walk repaints a view roughly every half minute, so the specs are patient.
    timeout: 600_000,
    expect: { timeout: 60_000 },
    retries: 1,
    workers: 1,
    reporter: [["list"]],
    use: {
        baseURL: local ? "http://127.0.0.1:4173/whichever/" : base,
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
        viewport: { width: 430, height: 900 },
    },
    webServer: local
        ? {
              command: "npm run preview -- --port 4173 --host 127.0.0.1",
              url: "http://127.0.0.1:4173/whichever/",
              reuseExistingServer: true,
              timeout: 60_000,
          }
        : undefined,
});
