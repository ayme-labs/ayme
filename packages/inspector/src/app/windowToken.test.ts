import { expect, it } from "vitest";

import { sessionSocket } from "./windowToken";

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

it("brings the token ayme inspect gives in the fragment to the socket, and leaves it out of the address", () => {
  const window = windowAt("http://127.0.0.1:4444/inspector#token=abc-_1");

  expect(sessionSocket(window)).toBe(
    "ws://127.0.0.1:4444/inspector/ws?token=abc-_1"
  );
  expect(window.replaced).toEqual(["/inspector"]);
});

it("after a reload, brings the token the tab kept", () => {
  const first = windowAt("http://127.0.0.1:4444/inspector#token=abc");
  sessionSocket(first);
  const reloaded = windowAt("http://127.0.0.1:4444/inspector", first.stored);

  expect(sessionSocket(reloaded)).toBe(
    "ws://127.0.0.1:4444/inspector/ws?token=abc"
  );
  expect(reloaded.replaced).toEqual([]);
});

it("without a token, connects without one, as to the server of ayme mcp of @ayme-dev/mcp", () => {
  expect(sessionSocket(windowAt("http://127.0.0.1:4444/inspector"))).toBe(
    "ws://127.0.0.1:4444/inspector/ws"
  );
});
