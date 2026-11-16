import { expect, it } from "vitest";

import { versionGap } from "./versionGap";

it("names both versions when the page speaks another pairing contract than the server", () => {
  expect(
    versionGap({
      page: { version: "0.2.0", contract: 1 },
      server: { version: "0.4.0", contract: 2 },
    })
  ).toBe(
    "Ayme 0.2.0 on the page and the Ayme MCP server 0.4.0 speak different pairing contracts."
  );
});

it("is silent for another version that speaks the same pairing contract", () => {
  expect(
    versionGap({
      page: { version: "0.2.0", contract: 1 },
      server: { version: "0.3.1", contract: 1 },
    })
  ).toBeUndefined();
});

it("counts a page from before the contract was named as speaking the first one", () => {
  expect(
    versionGap({ page: {}, server: { version: "0.3.0", contract: 1 } })
  ).toBeUndefined();
  expect(
    versionGap({ page: {}, server: { version: "0.4.0", contract: 2 } })
  ).toBe(
    "An earlier Ayme on the page and the Ayme MCP server 0.4.0 speak different pairing contracts."
  );
});
