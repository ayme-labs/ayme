import { defineConfig } from "@playwright/test";

export default defineConfig<{ recordedBrowser: "launch" | "attach" }>({
  testDir: "./tests",
  reporter: "list",
  projects: [
    { name: "launch" },
    // The main recording test again, on a running browser the recorder
    // attaches to.
    {
      name: "attach",
      use: { recordedBrowser: "attach" },
      testMatch: "recording.spec.ts",
      grep: /Finish writes the released Recording Package/,
    },
  ],
});
