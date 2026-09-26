import { useState, useSyncExternalStore } from "react";

export type ThemePreference = "system" | "light" | "dark";

const darkSchemeQuery = "(prefers-color-scheme: dark)";

function systemDarkQuery() {
  return typeof window.matchMedia === "function"
    ? window.matchMedia(darkSchemeQuery)
    : undefined;
}

function subscribeToSystemScheme(onChange: () => void) {
  const query = systemDarkQuery();
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
}

function systemPrefersDark() {
  return systemDarkQuery()?.matches ?? false;
}

/**
 * The Inspector's theme: the OS preference unless the user picks light or
 * dark. It applies to the Inspector's own root only, never the host page.
 */
export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>("system");
  const systemDark = useSyncExternalStore(
    subscribeToSystemScheme,
    systemPrefersDark,
    () => false
  );
  const dark = preference === "dark" || (preference === "system" && systemDark);
  return { preference, setPreference, dark };
}
