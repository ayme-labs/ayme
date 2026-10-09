import { expect, it } from "vitest";

// A schema that cannot be built throws while the module loads, which fails
// every importing test file before any test runs. Importing it inside a test
// turns that into a test failure Stryker can count.
it("builds every schema when the contract loads", async () => {
  await expect(import("./messages")).resolves.toHaveProperty(
    "ToolCallOutcomeSchema"
  );
});
