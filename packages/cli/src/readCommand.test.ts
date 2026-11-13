import { describe, expect, it } from "vitest";

import { readCommand, USAGE } from "./readCommand";

describe("readCommand", () => {
  it("lists the trace command in its usage text", () => {
    expect(USAGE).toContain("trace");
  });

  it("records the page at the URL for `codegen <url>`", () => {
    expect(readCommand(["codegen", "http://localhost:5173/cart"])).toEqual({
      kind: "codegen",
      url: "http://localhost:5173/cart",
    });
  });

  it("records a running browser for `codegen --cdp-endpoint <address>`, with no URL", () => {
    expect(
      readCommand(["codegen", "--cdp-endpoint", "http://127.0.0.1:9222"])
    ).toEqual({ kind: "attach", cdpEndpoint: "http://127.0.0.1:9222" });
  });

  it("fails with the usage text when it is given both a URL and a running browser", () => {
    expect(
      readCommand([
        "codegen",
        "http://localhost",
        "--cdp-endpoint",
        "http://127.0.0.1:9222",
      ])
    ).toEqual({
      kind: "error",
      text: `Give either a URL or --cdp-endpoint, not both: attaching never navigates the page.\n\n${USAGE}`,
    });
  });

  it.each([
    { args: ["latest"] },
    { args: ["rec_20261112T145047604Z"] },
    { args: ["open", "latest"] },
    // The stock tool's own words and flags are left as they are.
    { args: ["snapshot", "4", "--phase", "after", "eval", "document.title"] },
    { args: ["--help"] },
    { args: [] },
  ])("hands `trace $args` on to the stock trace tool as it is", ({ args }) => {
    expect(readCommand(["trace", ...args])).toEqual({ kind: "trace", args });
  });

  it.each([["--help"], ["-h"], ["codegen", "--help"]])(
    "prints the usage text for %j",
    (...args) => {
      expect(readCommand(args)).toEqual({ kind: "help", text: USAGE });
    }
  );

  it.each([
    { name: "no command", args: [] },
    { name: "an unknown command", args: ["record", "http://localhost"] },
    { name: "codegen without a URL", args: ["codegen"] },
    { name: "codegen with two URLs", args: ["codegen", "a", "b"] },
  ])("fails with the usage text for $name", ({ args }) => {
    expect(readCommand(args)).toEqual({ kind: "error", text: USAGE });
  });

  it("fails with the message and the usage text for an unknown option", () => {
    const command = readCommand(["codegen", "http://localhost", "--nope"]);

    expect(command.kind).toBe("error");
    expect(command).toHaveProperty(
      "text",
      expect.stringMatching(/^Unknown option '--nope'/)
    );
    expect(command).toHaveProperty("text", expect.stringContaining(USAGE));
  });
});
