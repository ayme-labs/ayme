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

  it("starts the server with the Page Objects entry --page-objects names", () => {
    expect(
      readCommand(["mcp", "--page-objects", "e2e/agent.ts", "--port", "9400"])
    ).toEqual({ kind: "start", port: 9400, pageObjects: "e2e/agent.ts" });
  });

  it("rejects --page-objects for `inspect`", () => {
    expect(readCommand(["inspect", "--page-objects", "a.ts"])).toEqual({
      kind: "error",
      text: `--page-objects is an option of \`ayme mcp\` only.\n\n${USAGE}`,
    });
  });

  it("rejects an empty --page-objects value", () => {
    expect(readCommand(["mcp", "--page-objects", ""])).toEqual({
      kind: "error",
      text: `--page-objects expects a file, got an empty value.\n\n${USAGE}`,
    });
  });

  it("marks --page-objects experimental in the usage text", () => {
    expect(USAGE).toMatch(/--page-objects <file>\s+Experimental:/);
  });

  it("starts the server listing Ayme's own Browser Tools for --browser-tools", () => {
    expect(readCommand(["mcp", "--browser-tools"])).toEqual({
      kind: "start",
      browserTools: true,
    });
  });

  it("reads --browser-tools together with the other options", () => {
    expect(
      readCommand([
        "mcp",
        "--page-objects",
        "e2e/agent.ts",
        "--browser-tools",
        "--port",
        "9400",
      ])
    ).toEqual({
      kind: "start",
      port: 9400,
      pageObjects: "e2e/agent.ts",
      browserTools: true,
    });
  });

  it("rejects --browser-tools for `inspect`", () => {
    expect(readCommand(["inspect", "--browser-tools"])).toEqual({
      kind: "error",
      text: `--browser-tools is an option of \`ayme mcp\` only.\n\n${USAGE}`,
    });
  });

  it("rejects a value for --browser-tools, which takes none", () => {
    const command = readCommand(["mcp", "--browser-tools=yes"]);

    expect(command).toMatchObject({ kind: "error" });
    expect((command as { text: string }).text).toContain("--browser-tools");
  });

  it("says in the usage text what --browser-tools adds, and does not mark it experimental", () => {
    expect(USAGE).toMatch(
      /--browser-tools\s+Also list Ayme's own Browser Tools, snapshot, goal and\s+Custom Tools/
    );
    expect(USAGE).not.toMatch(/--browser-tools\s+Experimental/);
  });

  it("prints the Inspector's URL for `inspect`, on the given port if any", () => {
    expect(readCommand(["inspect"])).toEqual({ kind: "inspect" });
    expect(readCommand(["inspect", "--port", "9400"])).toEqual({
      kind: "inspect",
      port: 9400,
    });
  });

  it.each([[1], [65_535]])("accepts the edge port %i", (port) => {
    expect(readCommand(["mcp", "--port", String(port)])).toEqual({
      kind: "start",
      port,
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
