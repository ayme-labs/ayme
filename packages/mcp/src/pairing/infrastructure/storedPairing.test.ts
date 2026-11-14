import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { PAIRING_STORAGE_KEY } from "../domain/pairingStorage";
import { storePairing, storedTabId } from "./storedPairing";

const pairing = { address: "ws://127.0.0.1:9350", token: "token" };
const originalTab = "original-tab";
let storage: Map<string, string>;

const stored = () => JSON.parse(storage.get(PAIRING_STORAGE_KEY)!);

beforeEach(() => {
  storage = new Map();
  vi.stubGlobal("window", {
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

it("keeps the stored tab id when a link names the stored pairing", () => {
  storePairing({ ...pairing, tab: originalTab });

  storePairing(pairing);

  expect(stored()).toEqual({ ...pairing, tab: originalTab });
  expect(storedTabId(pairing)).toBe(originalTab);
});

it.each([
  { ...pairing, address: "ws://127.0.0.1:9351" },
  { ...pairing, token: "another-token" },
])("gives a different pairing a new tab id: %j", (other) => {
  storePairing({ ...pairing, tab: originalTab });

  storePairing(other);

  expect(stored()).toEqual({
    ...other,
    tab: expect.stringMatching(/^[0-9a-f]{32}$/),
  });
  expect(stored().tab).not.toBe(originalTab);
});

it("gives a link a new tab id when no pairing is stored", () => {
  storePairing(pairing);

  expect(stored()).toEqual({
    ...pairing,
    tab: expect.stringMatching(/^[0-9a-f]{32}$/),
  });
});

it("keeps an explicit tab id when replacing a stored pairing", () => {
  storePairing({ ...pairing, tab: originalTab });

  storePairing({ ...pairing, tab: "explicit-tab" });

  expect(stored()).toEqual({ ...pairing, tab: "explicit-tab" });
});

it("adds a tab id to a legacy stored pairing and keeps it for the link", () => {
  storage.set(PAIRING_STORAGE_KEY, JSON.stringify(pairing));
  vi.stubGlobal("crypto", {
    getRandomValues: vi
      .fn()
      .mockImplementationOnce((bytes: Uint8Array) => bytes.fill(0x12))
      .mockImplementation((bytes: Uint8Array) => bytes.fill(0x34)),
  });
  storedTabId(pairing);

  storePairing(pairing);

  expect(stored()).toEqual({
    ...pairing,
    tab: "12121212121212121212121212121212",
  });
});

it("still accepts a link when sessionStorage is unavailable", () => {
  vi.stubGlobal("window", {
    get sessionStorage() {
      throw new Error("Storage unavailable");
    },
  });

  expect(() => storePairing(pairing)).not.toThrow();
});
