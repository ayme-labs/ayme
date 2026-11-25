export type ThemePreference = "system" | "light" | "dark";

export const THEME_LABELS: Record<ThemePreference, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

const NEXT: Record<ThemePreference, ThemePreference> = {
  system: "light",
  light: "dark",
  dark: "system",
};

/** The choice one press of the switch moves to. */
export const nextTheme = (preference: ThemePreference) => NEXT[preference];

/** Whether the window is dark: chosen, or the system's when nothing else
 * was chosen. */
export const isDark = (preference: ThemePreference, systemDark: boolean) =>
  preference === "dark" || (preference === "system" && systemDark);

/** A choice as it was stored; the system's when none, or none known. */
export const storedTheme = (stored: string | null): ThemePreference =>
  stored === "light" || stored === "dark" ? stored : "system";
