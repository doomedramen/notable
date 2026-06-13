import { defineConfig, devices } from "@playwright/test";

/* E2E runs against the real Rust server (which serves the built frontend
   via rust-embed — run `npm run build` first) on a throwaway vault + DB. */
export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  // The server is shared state (one vault); keep tests serial.
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:8090",
  },
  projects: [
    {
      name: "desktop",
      testMatch: /smoke\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Mobile-first is a product requirement: phone PWA is a primary
      // target. Drawer/sheet behavior lives in mobile.spec.ts.
      name: "mobile",
      testMatch: /mobile\.spec\.ts/,
      use: { ...devices["iPhone 14"], browserName: "chromium" },
    },
  ],
  webServer: {
    command:
      "rm -rf /tmp/notable-e2e-vault /tmp/notable-e2e.db* && cd ../backend && cargo run -- --headless --bind 127.0.0.1:8090 --vault-dir /tmp/notable-e2e-vault --database-url sqlite:///tmp/notable-e2e.db --plugins-dir ../plugins --core-plugins-dir ../core-plugins --themes-dir ../themes",
    url: "http://127.0.0.1:8090",
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
