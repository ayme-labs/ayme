import { describe, expect, it } from "vitest";

import { planOf } from "./plan";

// What the command line does for each command it has read: print and stop,
// or hand over to one of the four things it runs.

describe("what the command line does for a command", () => {
  it("prints the usage text for help on stdout, and exits with 0", () => {
    expect(planOf({ kind: "help", text: "Usage: x\n" })).toEqual({
      kind: "print",
      stream: "stdout",
      text: "Usage: x\n",
      exitCode: 0,
    });
  });

  it("prints what is wrong on stderr, and exits with 1", () => {
    expect(planOf({ kind: "error", text: "Nope.\n\nUsage: x\n" })).toEqual({
      kind: "print",
      stream: "stderr",
      text: "Nope.\n\nUsage: x\n",
      exitCode: 1,
    });
  });

  it("records a URL, with the window setting when it was given", () => {
    expect(planOf({ kind: "codegen", url: "http://localhost" })).toEqual({
      kind: "codegen",
      target: { url: "http://localhost", headless: undefined },
    });
    expect(
      planOf({ kind: "codegen", url: "http://localhost", headless: true })
    ).toEqual({
      kind: "codegen",
      target: { url: "http://localhost", headless: true },
    });
  });

  it("records a running browser at its address", () => {
    expect(
      planOf({ kind: "attach", cdpEndpoint: "http://127.0.0.1:9222" })
    ).toEqual({
      kind: "codegen",
      target: { cdpEndpoint: "http://127.0.0.1:9222" },
    });
  });

  it("hands install and trace their arguments as they are", () => {
    expect(
      planOf({ kind: "install", args: ["--with-deps", "chromium"] })
    ).toEqual({ kind: "install", args: ["--with-deps", "chromium"] });
    expect(planOf({ kind: "trace", args: ["latest"] })).toEqual({
      kind: "trace",
      args: ["latest"],
    });
  });
});
