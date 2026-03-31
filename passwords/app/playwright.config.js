// @ts-check
const { defineConfig } = require("@playwright/test");

/**
 * Playwright configuration for MapoPass e2e tests.
 *
 * Automatically starts the Rust API server (port 8000) and the React dev
 * server (port 3000) before running tests, and tears them down afterwards.
 *
 * Prerequisites:
 *   - Rust toolchain with `cargo` available
 *   - Node.js with `npm` available
 *   - MongoDB credentials in `../api/.env`
 *   - `npx playwright install chromium` run at least once
 */
module.exports = defineConfig({
  testDir: "./e2e",

  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,

  /* No retries — tests should be deterministic. */
  retries: 0,

  /* Single worker — the tests are sequential within one file by design. */
  workers: 1,

  /* Generous timeout for e2e; servers may be slow to start. */
  timeout: 60_000,

  use: {
    baseURL: "http://localhost:3000",
    /* Headless by default; set `headed: true` locally to watch. */
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],

  /* Start the Rocket API then the React dev server. */
  webServer: [
    {
      command: "cargo run",
      cwd: "../api",
      port: 8000,
      /* API may take a while to compile + start. */
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "BROWSER=none npm start",
      cwd: ".",
      port: 3000,
      timeout: 60_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
