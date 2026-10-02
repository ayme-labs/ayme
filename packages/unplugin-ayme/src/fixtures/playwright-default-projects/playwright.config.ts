import { defineConfig } from "@playwright/test";

export default defineConfig({
  projects: [
    { name: "chromium", use: {} },
    { name: "firefox", use: { testIdAttribute: "data-testid" } },
  ],
});
