import { useCallback, useState, useSyncExternalStore } from "react";

import { isDark, storedTheme, type ThemePreference } from "../domain/theme";

const darkScheme = "(prefers-color-scheme: dark)";
/** Where the window keeps the person's choice, in this browser only. */
const STORAGE_KEY = "ayme-recorder-theme";

const subscribeToScheme = (onChange: () => void) => {
  const query = matchMedia(darkScheme);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};
const systemIsDark = () => matchMedia(darkScheme).matches;

/** Whether the system's scheme is dark, followed live. */
export const useSystemDark = () =>
  useSyncExternalStore(subscribeToScheme, systemIsDark);

function readStored(): ThemePreference {
  try {
    return storedTheme(localStorage.getItem(STORAGE_KEY));
  } catch {
    // Storage that cannot be read keeps nothing: the system's scheme.
    return "system";
  }
}

/**
 * The window's theme: the person's choice, kept in this browser, and
 * whether the window is dark, which follows the system's scheme live while
 * the choice is "system".
 */
export function useTheme() {
  const [preference, setPreference] = useState(readStored);
  const systemDark = useSystemDark();
  const choose = useCallback((next: ThemePreference) => {
    setPreference(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // A choice that cannot be stored lasts until the window reloads.
    }
  }, []);
  return { preference, choose, dark: isDark(preference, systemDark) };
}
