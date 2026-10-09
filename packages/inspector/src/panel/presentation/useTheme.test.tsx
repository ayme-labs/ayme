import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import type { ThemePreference } from "../domain/preferences";
import { useDarkTheme } from "./useTheme";

// Unit tests: whether the Inspector is dark, over a stand-in for the OS
// colour scheme preference.

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The OS prefers a dark colour scheme: only that media query matches. */
function preferDarkScheme() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(prefers-color-scheme: dark)",
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

function isDark(preference: ThemePreference) {
  let dark: boolean | undefined;
  function Probe() {
    dark = useDarkTheme(preference);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(<Probe />));
  act(() => root.unmount());
  return dark;
}

it("follows the OS's dark colour scheme for the system theme", () => {
  preferDarkScheme();

  expect(isDark("system")).toBe(true);
  expect(isDark("light")).toBe(false);
});
