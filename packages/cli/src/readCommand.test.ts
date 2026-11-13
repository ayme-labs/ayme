import { describe, expect, it } from "vitest";

import { readCommand, USAGE } from "./readCommand";

describe("readCommand", () => {
  it("records the page at the URL for `codegen <url>`", () => {
    expect(readCommand(["codegen", "http://localhost:5173/cart"])).toEqual({
      kind: "codegen",
      url: "http://localhost:5173/cart",
    });
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
