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

it("with the tab's storage blocked, still connects with the code, then the token, and leaves the code out of the address", () => {
  const window = windowAt("http://127.0.0.1:4444/inspector#code=abc");
  Object.defineProperty(window, "sessionStorage", {
    get() {
      throw new DOMException("Access is denied.", "SecurityError");
    },
  });

  const admission = windowAdmission(window);

  expect(admission.socket()).toBe("ws://127.0.0.1:4444/inspector/ws?code=abc");
  expect(window.replaced).toEqual(["/inspector"]);
  admission.admitted("secret");
  expect(admission.socket()).toBe(
    "ws://127.0.0.1:4444/inspector/ws?token=secret"
  );
});

it("with the tab's storage blocked, connects without a token, as to the server of ayme mcp of @ayme-dev/mcp", () => {
  const window = windowAt("http://127.0.0.1:4444/inspector");
  Object.defineProperty(window, "sessionStorage", {
    get() {
      throw new DOMException("Access is denied.", "SecurityError");
    },
  });

  expect(windowAdmission(window).socket()).toBe(
    "ws://127.0.0.1:4444/inspector/ws"
  );
});

it("when the tab's storage is full, keeps the token for this page", () => {
  const window = windowAt("http://127.0.0.1:4444/inspector#code=abc");
  window.sessionStorage.setItem = () => {
    throw new DOMException(
      "The quota has been exceeded.",
      "QuotaExceededError"
    );
  };
  const admission = windowAdmission(window);

  admission.admitted("secret");

  expect(admission.socket()).toBe(
    "ws://127.0.0.1:4444/inspector/ws?token=secret"
  );
});
