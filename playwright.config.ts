import { defineConfig, devices } from "@playwright/test";

// Override when port 3000 is taken, e.g. by a dev server serving the real journal.
const port = Number.parseInt(process.env.PARALOG_E2E_PORT || "3000", 10);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "line",
  use: {
    baseURL,
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: "mise exec -- node scripts/test-server.mjs serve",
    url: baseURL,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      PARALOG_TEST_PORT: String(port),
      PARALOG_TEST_RESET: "1",
      PARALOG_TEST_DATA_DIR: ".test-data/e2e",
      PARALOG_TEST_PASSWORD: "paralog",
      PARALOG_TEST_AUTH_SECRET: "paralog-e2e-secret-not-for-production",
      // The dev server only serves its scripts to allowed origins, and the tests
      // reach it as 127.0.0.1 rather than localhost.
      PARALOG_ALLOWED_DEV_ORIGINS: "127.0.0.1",
    },
  },
});
