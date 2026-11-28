// The rest of a Node Host's Inspector contract needs a real Page: the
// built package's nodeHostInspector.node.test.ts and apps/mcp-fixture's
// inspectSession.spec.ts prove it.
import { expect, it } from "vitest";

import { inspectorPortOf } from "./nodeHostInspector";

it("serves no Inspector contract for what is not a Node Host's session", () => {
  expect(() =>
    inspectorPortOf({ tools: {} } as Parameters<typeof inspectorPortOf>[0])
  ).toThrow("This is not a Node Host's session.");
});
