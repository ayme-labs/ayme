import { expect, it } from "vitest";

import { busyRefuses } from "./busyServer";

it("lets any tab pair without a token while the server works with no tab", () => {
  expect(busyRefuses({ busyWith: undefined, tab: "a" })).toBe(false);
});

it("lets the tab it works with reconnect without a token", () => {
  expect(busyRefuses({ busyWith: "a", tab: "a" })).toBe(false);
});

it("refuses another tab without a token while it works with a tab", () => {
  expect(busyRefuses({ busyWith: "a", tab: "b" })).toBe(true);
});
