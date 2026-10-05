import { expect, it } from "vitest";

import { connectLink, pairingFromFragment } from "./pairing";

const pairing = { address: "ws://127.0.0.1:9351", token: "f00d" };

it("appends the server's address and token to the app URL as its fragment", () => {
  expect(connectLink("http://localhost:5173/todos?filter=open", pairing)).toBe(
    "http://localhost:5173/todos?filter=open#ayme=ws://127.0.0.1:9351/f00d"
  );
  expect(() => connectLink("localhost:5173", pairing)).toThrow(
    "Expected an http or https URL"
  );
});

it("reads the pairing back from a connect link's fragment", () => {
  const link = new URL(connectLink("http://localhost:5173/", pairing));
  expect(pairingFromFragment(link.hash)).toEqual(pairing);
});

it("pairs only with a loopback WebSocket address", () => {
  for (const hash of [
    "",
    "#todos",
    "#ayme=wss://127.0.0.1:9351/f00d",
    "#ayme=ws://example.com:9351/f00d",
    "#ayme=ws://127.0.0.1:9351/",
    "#ayme=not a url",
  ])
    expect(pairingFromFragment(hash), hash).toBeUndefined();
});
