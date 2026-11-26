import { expect, it } from "vitest";

import { pageTargets, tabListAddress } from "./tabList";

it.each([
  ["http://127.0.0.1:9222", "http://127.0.0.1:9222/json/list"],
  ["http://127.0.0.1:9222/", "http://127.0.0.1:9222/json/list"],
  [
    "ws://127.0.0.1:9222/devtools/browser/5e0c-41",
    "http://127.0.0.1:9222/json/list",
  ],
  [
    "wss://browser.example:443/devtools/browser/1",
    "https://browser.example/json/list",
  ],
])("reads the tab list of the browser at %s from %s", (address, list) => {
  expect(tabListAddress(address)).toBe(list);
});

it("keeps the browser's order of its tabs, most recently active first, and leaves out every target that is no tab", () => {
  // As Chromium gives them, with more about each than ayme reads.
  const list = [
    { id: "C", type: "page", url: "http://127.0.0.1:5173/sign-in.html" },
    { id: "W", type: "service_worker", url: "http://127.0.0.1:5173/sw.js" },
    { id: "A", type: "page", url: "http://127.0.0.1:5173/shop.html" },
    { id: "F", type: "iframe", url: "http://127.0.0.1:5174/" },
    { id: "B", type: "page", url: "about:blank" },
  ];

  expect(pageTargets(list)).toEqual(["C", "A", "B"]);
});
