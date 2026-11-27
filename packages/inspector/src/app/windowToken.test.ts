import { expect, it } from "vitest";

import { windowAdmission } from "./windowToken";

/** A browser window at `href`, with a tab's session storage. */
function windowAt(href: string, stored: Record<string, string> = {}) {
  const url = new URL(href);
  const replaced: string[] = [];
  return {
    location: url,
    history: {
      replaceState: (_data: unknown, _unused: string, to: string) => {
        replaced.push(to);
        Object.assign(url, { hash: "" });
      },
    },
    sessionStorage: {
      getItem: (key: string) => stored[key] ?? null,
      setItem: (key: string, value: string) => void (stored[key] = value),
    },
    replaced,
    stored,
  };
}

it("connects first with the one-use code ayme inspect gives in the fragment, and leaves it out of the address", () => {
  const window = windowAt("http://127.0.0.1:4444/inspector#code=abc-_1");

  expect(windowAdmission(window).socket()).toBe(
    "ws://127.0.0.1:4444/inspector/ws?code=abc-_1"
  );
  expect(window.replaced).toEqual(["/inspector"]);
});

it("once admitted, connects again with the token the Session told it, and after a reload with the token the tab kept", () => {
  const first = windowAt("http://127.0.0.1:4444/inspector#code=abc");
  const admission = windowAdmission(first);

  admission.admitted("secret");

  expect(admission.socket()).toBe(
    "ws://127.0.0.1:4444/inspector/ws?token=secret"
  );
  const reloaded = windowAt("http://127.0.0.1:4444/inspector", first.stored);
  expect(windowAdmission(reloaded).socket()).toBe(
    "ws://127.0.0.1:4444/inspector/ws?token=secret"
  );
  expect(reloaded.replaced).toEqual([]);
});

it("connects with a new code given in the address, before a token the tab kept", () => {
  const window = windowAt("http://127.0.0.1:4444/inspector#code=new", {
    "ayme:inspector-token": JSON.stringify("old"),
  });

  expect(windowAdmission(window).socket()).toBe(
    "ws://127.0.0.1:4444/inspector/ws?code=new"
  );
});

it("without a code or a token, connects without either, as to the server of ayme mcp of @ayme-dev/mcp", () => {
  expect(
    windowAdmission(windowAt("http://127.0.0.1:4444/inspector")).socket()
  ).toBe("ws://127.0.0.1:4444/inspector/ws");
});
