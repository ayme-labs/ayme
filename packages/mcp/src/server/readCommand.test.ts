import { describe, expect, it } from "vitest";

import { readCommand, USAGE } from "./readCommand";

describe("readCommand", () => {
  it.each([["--help"], ["-h"], ["mcp", "--help"], ["mcp", "-h"]])(
    "prints the usage text for %j",
    (...args) => {
      expect(readCommand(args)).toEqual({ kind: "help", text: USAGE });
    }
  );

  it("prefers help over a bad --port", () => {
    expect(readCommand(["mcp", "--port", "nope", "--help"])).toEqual({
      kind: "help",
      text: USAGE,
    });
  });

  it("starts the server on its own range for `mcp`", () => {
    expect(readCommand(["mcp"])).toEqual({ kind: "start" });
  });

  it("starts the server on the given port", () => {
    expect(readCommand(["mcp", "--port", "9400"])).toEqual({
      kind: "start",
      port: 9400,
    });
  });

  it.each([["0"], ["65536"], ["1.5"], ["abc"]])(
    "rejects the port %j and shows the usage text",
    (port) => {
      expect(readCommand(["mcp", "--port", port])).toEqual({
        kind: "error",
        text: `--port expects a port number, got "${port}".\n\n${USAGE}`,
      });
    }
  );

  it.each([[[]], [["serve"]], [["mcp", "extra"]]])(
    "shows only the usage text for %j",
    (args) => {
      expect(readCommand(args)).toEqual({ kind: "error", text: USAGE });
    }
  );

  it("reports an unknown option with the usage text", () => {
    const command = readCommand(["mcp", "--nope"]);

    expect(command).toMatchObject({ kind: "error" });
    expect((command as { text: string }).text).toContain("--nope");
    expect((command as { text: string }).text.endsWith(`\n\n${USAGE}`)).toBe(
      true
    );
  });
});
