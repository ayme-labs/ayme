import { afterEach, expect, it, vi } from "vitest";

import { defaultPreferences, type Preferences } from "../domain/preferences";
import {
  browserStorage,
  preferencesKey,
  readPreferences,
  writePreferences,
} from "./preferencesStorage";

// Unit tests: how the panel's preferences are remembered per site, and what
// it falls back to when they can't be.

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const items = new Map(Object.entries(initial));
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, value),
  };
}

function unavailableStorage(): Storage {
  const fail = () => {
    throw new DOMException("Storage is disabled.", "SecurityError");
  };
  return { ...memoryStorage(), getItem: fail, setItem: fail };
}

afterEach(() => {
  vi.restoreAllMocks();
});

it("remembers the layout, sizes, positions, theme, Model lens panes and region sizes it was left with", () => {
  const storage = memoryStorage();
  const left: Preferences = {
    layout: "bottom",
    collapsed: true,
    theme: "dark",
    float: { x: 40, y: 30, width: 600, height: 560 },
    sideWidth: 700,
    bottomHeight: 300,
    logo: { x: 20, y: 500 },
    modelPanes: { objectsOpen: false, modelsOpen: true, split: 0.3 },
    regions: { navigatorWidth: 320, runsHeight: 200, runsWidth: 480 },
  };

  writePreferences(storage, left);

  expect(readPreferences(storage)).toEqual(left);
});

it("keeps its preferences under its own key in the site's storage", () => {
  expect(preferencesKey).toBe("ayme-inspector:preferences");
});

it.each(["float", "left", "right", "bottom"] as const)(
  "remembers the %s layout",
  (layout) => {
    const storage = memoryStorage();
    writePreferences(storage, { ...defaultPreferences, layout });
    expect(readPreferences(storage).layout).toBe(layout);
  }
);

it.each(["system", "light", "dark"] as const)(
  "remembers the %s theme",
  (theme) => {
    const storage = memoryStorage();
    writePreferences(storage, { ...defaultPreferences, theme });
    expect(readPreferences(storage).theme).toBe(theme);
  }
);

it("falls back to the default layout and theme for empty ones", () => {
  const storage = memoryStorage({
    [preferencesKey]: JSON.stringify({ layout: "", theme: "" }),
  });
  expect(readPreferences(storage)).toMatchObject({
    layout: "float",
    theme: "system",
  });
});

it("opens with the defaults when nothing is stored yet", () => {
  expect(readPreferences(memoryStorage())).toEqual({
    layout: "float",
    collapsed: false,
    theme: "system",
    sideWidth: 640,
    bottomHeight: 360,
    modelPanes: { objectsOpen: true, modelsOpen: true, split: 0.58 },
    regions: {},
  });
});

it("keeps each valid stored value and defaults the malformed ones", () => {
  const storage = memoryStorage({
    [preferencesKey]: JSON.stringify({
      layout: "diagonal",
      theme: "dark",
      sideWidth: 700,
      bottomHeight: -5,
      float: { x: "left", y: 0, width: 600, height: 500 },
      logo: { x: 10, y: 12 },
      modelPanes: { objectsOpen: "no", modelsOpen: false, split: 0.95 },
      regions: { navigatorWidth: 320, runsHeight: 0, runsWidth: "wide" },
    }),
  });

  expect(readPreferences(storage)).toEqual({
    layout: "float",
    collapsed: false,
    theme: "dark",
    sideWidth: 700,
    bottomHeight: 360,
    logo: { x: 10, y: 12 },
    modelPanes: { objectsOpen: true, modelsOpen: false, split: 0.58 },
    regions: { navigatorWidth: 320 },
  });
});

it("opens with the defaults when the stored preferences aren't JSON", () => {
  const storage = memoryStorage({ [preferencesKey]: "{not json" });

  expect(readPreferences(storage)).toEqual(defaultPreferences);
});

it("opens with the defaults when storage is unavailable", () => {
  vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
    throw new DOMException("Storage is disabled.", "SecurityError");
  });

  expect(readPreferences(browserStorage())).toEqual(defaultPreferences);
  expect(readPreferences(unavailableStorage())).toEqual(defaultPreferences);
});

it("keeps working when the preferences can't be stored", () => {
  expect(() =>
    writePreferences(unavailableStorage(), defaultPreferences)
  ).not.toThrow();
  expect(() => writePreferences(undefined, defaultPreferences)).not.toThrow();
});
