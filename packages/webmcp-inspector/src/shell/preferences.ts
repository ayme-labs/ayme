/** Where the panel sits: floating over the page, or docked to an edge. */
export type Layout = "float" | "left" | "right" | "bottom";

export type ThemePreference = "system" | "light" | "dark";

export type Point = { x: number; y: number };

export type Rect = Point & { width: number; height: number };

/**
 * How the person left the panel. Positions and sizes are in viewport pixels.
 * An unset floating rectangle or logo position means "the default place",
 * which depends on the viewport.
 */
export type Preferences = {
  layout: Layout;
  collapsed: boolean;
  theme: ThemePreference;
  float?: Rect;
  /** The width of the left or right dock. */
  sideWidth: number;
  /** The height of the bottom dock. */
  bottomHeight: number;
  logo?: Point;
};

export const defaultPreferences: Preferences = {
  layout: "float",
  collapsed: false,
  theme: "system",
  sideWidth: 640,
  bottomHeight: 360,
};

/** Browser storage is per origin, so the preferences are per site. */
export const preferencesKey = "ayme-inspector:preferences";

const layouts: readonly Layout[] = ["float", "left", "right", "bottom"];
const themes: readonly ThemePreference[] = ["system", "light", "dark"];

/**
 * Reads the stored preferences. Each value that is missing, malformed or
 * unreadable falls back to its default, as does everything when storage is
 * unavailable.
 */
export function readPreferences(storage: Storage | undefined): Preferences {
  let stored: unknown;
  try {
    const text = storage?.getItem(preferencesKey);
    stored = text ? JSON.parse(text) : undefined;
  } catch {
    stored = undefined;
  }
  if (!isRecord(stored)) return defaultPreferences;

  return {
    layout: oneOf(stored.layout, layouts) ?? defaultPreferences.layout,
    collapsed:
      typeof stored.collapsed === "boolean"
        ? stored.collapsed
        : defaultPreferences.collapsed,
    theme: oneOf(stored.theme, themes) ?? defaultPreferences.theme,
    float: isRect(stored.float) ? pick(stored.float, rectKeys) : undefined,
    sideWidth: isSize(stored.sideWidth)
      ? stored.sideWidth
      : defaultPreferences.sideWidth,
    bottomHeight: isSize(stored.bottomHeight)
      ? stored.bottomHeight
      : defaultPreferences.bottomHeight,
    logo: isPoint(stored.logo) ? pick(stored.logo, pointKeys) : undefined,
  };
}

/** Stores the preferences. Without usable storage, they last for the page. */
export function writePreferences(
  storage: Storage | undefined,
  preferences: Preferences
) {
  try {
    storage?.setItem(preferencesKey, JSON.stringify(preferences));
  } catch {
    // Storage is full, blocked or gone: keep the preferences in memory only.
  }
}

/** The page's storage, or nothing when the browser denies access to it. */
export function browserStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

const pointKeys = ["x", "y"] as const;
const rectKeys = ["x", "y", "width", "height"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function oneOf<T extends string>(value: unknown, options: readonly T[]) {
  return options.find((option) => option === value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSize(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

function isPoint(value: unknown): value is Point {
  return (
    isRecord(value) && pointKeys.every((key) => isFiniteNumber(value[key]))
  );
}

function isRect(value: unknown): value is Rect {
  return (
    isPoint(value) &&
    isSize((value as Rect).width) &&
    isSize((value as Rect).height)
  );
}

function pick<T, K extends keyof T>(value: T, keys: readonly K[]) {
  return Object.fromEntries(keys.map((key) => [key, value[key]])) as Pick<T, K>;
}
