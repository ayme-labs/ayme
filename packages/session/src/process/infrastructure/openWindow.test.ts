import { expect, it } from "vitest";

import { openerOf } from "./openWindow";

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
