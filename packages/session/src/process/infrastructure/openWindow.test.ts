import { describe, expect, it } from "vitest";

import { openerOf, startOpener } from "./openWindow";

const URL_ = "http://127.0.0.1:4444/inspector";

it.each([
  ["darwin", { command: "open", args: [URL_] }],
  ["linux", { command: "xdg-open", args: [URL_] }],
  ["win32", { command: "cmd", args: ["/c", "start", '""', URL_] }],
] as const)(
  "opens the person's default browser with the system's own opener on %s",
  (platform, opener) => {
    expect(openerOf(URL_, {}, platform)).toEqual(opener);
  }
);

it("opens it with the program BROWSER names, as other development tools do", () => {
  expect(openerOf(URL_, { BROWSER: "/usr/bin/firefox" }, "linux")).toEqual({
    command: "/usr/bin/firefox",
    args: [URL_],
  });
});

it("opens nothing when BROWSER is none", () => {
  expect(openerOf(URL_, { BROWSER: "none" }, "darwin")).toBeUndefined();
});

describe("starting the opener", () => {
  it("says why when its program does not exist", async () => {
    expect(
      await startOpener({ command: "/no/such/opener", args: [URL_] })
    ).toContain("ENOENT");
  });

  it("says why when its program exits with a failure", async () => {
    expect(await startOpener({ command: "false", args: [] })).toBe(
      "false exited with code 1."
    );
  });

  it("says nothing when its program ends well", async () => {
    expect(await startOpener({ command: "true", args: [] })).toBeUndefined();
  });

  it("waits only its short time for a program that stays open, as a browser BROWSER names may", async () => {
    const started = Date.now();

    expect(
      await startOpener({ command: "sleep", args: ["2"] }, 100)
    ).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
