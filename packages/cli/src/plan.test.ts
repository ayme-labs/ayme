import { describe, expect, it } from "vitest";

import { version } from "../package.json";
import { planOf } from "./plan";

// What the command line does for each command it has read: print and stop,
// or record with `ayme capture`.

describe("what the command line does for a command", () => {
  it("prints the usage text for help on stdout, and exits with 0", () => {
    expect(planOf({ kind: "help", text: "Usage: x\n" })).toEqual({
      kind: "print",
      stream: "stdout",
      text: "Usage: x\n",
      exitCode: 0,
    });
  });

  it("prints the package's version alone on stdout, and exits with 0", () => {
    expect(planOf({ kind: "version" })).toEqual({
      kind: "print",
      stream: "stdout",
      text: `${version}\n`,
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

  it("records the target it was given, a URL or a running browser", () => {
    expect(
      planOf({
        kind: "capture",
        target: {
          url: "http://localhost",
          startRecording: true,
          loadStorage: "auth.json",
        },
      })
    ).toEqual({
      kind: "capture",
      target: {
        url: "http://localhost",
        startRecording: true,
        loadStorage: "auth.json",
      },
    });
    expect(
      planOf({ kind: "capture", target: { cdp: "http://127.0.0.1:9222" } })
    ).toEqual({ kind: "capture", target: { cdp: "http://127.0.0.1:9222" } });
  });

  it.each([
    { kind: "open", open: { headed: false }, json: true },
    { kind: "attach", cdp: "http://127.0.0.1:9222", json: false },
    { kind: "ask", request: { detach: {} }, json: false, session: "review" },
    { kind: "call", tool: "Basket.add", params: "@add.json", json: false },
    { kind: "list", json: false },
    { kind: "session process", options: "{}" },
  ] as const)("reaches a Session as the command asks: $kind", (command) => {
    expect(planOf(command)).toEqual(command);
  });
});
