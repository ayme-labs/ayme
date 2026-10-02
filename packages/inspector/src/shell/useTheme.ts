import { useSyncExternalStore } from "react";

import type { ThemePreference } from "./preferences";

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
 * Whether the Inspector is dark: the OS preference, followed live, unless
 * the person picked light or dark. It applies to the Inspector's own root
 * only, never the host page.
 */
export function useDarkTheme(preference: ThemePreference) {
  const systemDark = useSyncExternalStore(
    subscribeToSystemScheme,
    systemPrefersDark,
    () => false
  );
  return preference === "dark" || (preference === "system" && systemDark);
}
