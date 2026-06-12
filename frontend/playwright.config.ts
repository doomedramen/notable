import { defineConfig } from "@playwright/test";

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
  webServer: {
    command:
      "rm -rf /tmp/notable-e2e-vault /tmp/notable-e2e.db* && cd ../backend && cargo run -- --headless --bind 127.0.0.1:8090 --vault-dir /tmp/notable-e2e-vault --database-url sqlite:///tmp/notable-e2e.db --plugins-dir ../plugins",
    url: "http://127.0.0.1:8090",
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
