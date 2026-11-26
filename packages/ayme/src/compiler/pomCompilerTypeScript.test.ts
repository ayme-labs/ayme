import { expect, it, vi } from "vitest";

import { createPomCompiler } from "./pomCompiler";

// Only a TypeScript outside the range shows the compiler checks it, and CI installs none.
vi.mock("./typescriptApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./typescriptApi")>()),
  typeScriptVersion: "8.0.0",
}));

it("refuses to start on a TypeScript outside the supported range", () => {
  expect(() => createPomCompiler()).toThrow(
    "[ayme] TypeScript 8.0.0 is installed, and the Page Object compiler supports TypeScript >=5.4 <8."
  );
});
