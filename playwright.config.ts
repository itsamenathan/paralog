import { defineConfig, devices } from "@playwright/test";

const port = 3100;
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
    },
  },
});
