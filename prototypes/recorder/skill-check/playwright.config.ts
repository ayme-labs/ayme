import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  reporter: "list",
  use: {
    baseURL: "https://www.saucedemo.com",
    // SauceDemo marks its elements with data-test (read from the trace)
    testIdAttribute: "data-test",
  },
});
