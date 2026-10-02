import { defineConfig } from "@playwright/test";

export default defineConfig({
  use: {
    testIdAttribute: "data-pw,data-ti",
    actionTimeout: 11,
    navigationTimeout: 22,
    baseURL: "https://not-in-the-browser-bundle.example",
  },
  projects: [],
});
