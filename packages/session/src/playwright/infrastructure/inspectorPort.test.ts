import { expect, it, vi } from "vitest";

import { lazyPort } from "./inspectorPort";

const port = () => ({
  request: vi.fn(async (method: string) => method),
  subscribe: vi.fn(() => () => {}),
});

it("makes no port until a window first asks the Tab's contract", () => {
  const make = vi.fn(port);

  lazyPort(make);

  expect(make).not.toHaveBeenCalled();
});

it("makes the port once, on the first request or subscription, and goes on with it", async () => {
  const made = port();
  const make = vi.fn(() => made);
  const lazy = lazyPort(make);

  expect(await lazy.request("getState", undefined)).toBe("getState");
  lazy.subscribe(() => {});
  await lazy.request("look", undefined);

  expect(make).toHaveBeenCalledTimes(1);
  expect(made.request.mock.calls.map(([method]) => method)).toEqual([
    "getState",
    "look",
  ]);
  expect(made.subscribe).toHaveBeenCalledTimes(1);
});
