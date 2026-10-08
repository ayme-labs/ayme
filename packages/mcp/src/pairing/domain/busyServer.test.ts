import { expect, it } from "vitest";

import { BUSY_SERVER, SERVER_IDENTITY } from "./admission";
import { busyRefuses, probeAnswer } from "./busyServer";

it("lets any tab pair without a token while the server works with no tab", () => {
  expect(busyRefuses({ busyWith: undefined, tab: "a" })).toBe(false);
});

it("lets the tab it works with reconnect without a token", () => {
  expect(busyRefuses({ busyWith: "a", tab: "a" })).toBe(false);
});

it("refuses another tab without a token while it works with a tab", () => {
  expect(busyRefuses({ busyWith: "a", tab: "b" })).toBe(true);
});

it("tells a page's probe it is busy while it works with a tab", () => {
  expect(probeAnswer({ busyWith: undefined, origin: "http://localhost" })).toBe(
    SERVER_IDENTITY
  );
  expect(probeAnswer({ busyWith: "a", origin: "http://localhost" })).toBe(
    BUSY_SERVER
  );
});

it("tells a local process's probe who it is even while it works with a tab", () => {
  expect(probeAnswer({ busyWith: "a", origin: undefined })).toBe(
    SERVER_IDENTITY
  );
});
