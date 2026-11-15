import { describe, expect, it } from "vitest";

import { isDark, nextTheme, storedTheme, THEME_LABELS } from "./theme";

// The window's theme: the system's scheme, followed live, unless the person
// chose light or dark, as the Inspector's switch does.

describe("the theme", () => {
  it("goes from System to Light to Dark and back, one press at a time", () => {
    expect(nextTheme("system")).toBe("light");
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("system");
  });

  it("is named for a person", () => {
    expect(THEME_LABELS).toEqual({
      system: "System",
      light: "Light",
      dark: "Dark",
    });
  });

  it("is dark when chosen, or when the system is and nothing else was chosen", () => {
    expect(isDark("dark", false)).toBe(true);
    expect(isDark("light", true)).toBe(false);
    expect(isDark("system", true)).toBe(true);
    expect(isDark("system", false)).toBe(false);
  });

  it("reads a stored choice, and follows the system when there is none", () => {
    expect(storedTheme("dark")).toBe("dark");
    expect(storedTheme("light")).toBe("light");
    expect(storedTheme("system")).toBe("system");
    expect(storedTheme(null)).toBe("system");
    expect(storedTheme("purple")).toBe("system");
  });
});
