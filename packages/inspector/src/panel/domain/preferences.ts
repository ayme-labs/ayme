/** Where the panel sits: floating over the page, or docked to an edge. */
export type Layout = "float" | "left" | "right" | "bottom";

export type ThemePreference = "system" | "light" | "dark";

export type Point = { x: number; y: number };

export type Rect = Point & { width: number; height: number };

/** The Model lens's two panes: which are open, and the first one's share. */
export type ModelPanes = {
  objectsOpen: boolean;
  modelsOpen: boolean;
  /** The share of the height "On this page" gets when both are open. */
  split: number;
};

/** The bounds of the Model lens's divider, as a share of the height. */
export const minModelSplit = 0.15;
export const maxModelSplit = 0.85;

/**
 * How the person left the panel. Positions and sizes are in viewport pixels.
 * An unset floating rectangle or logo position means "the default place",
 * which depends on the viewport.
 */
export type Preferences = {
  layout: Layout;
  collapsed: boolean;
  theme: ThemePreference;
  /** Whether the panel and the logo are glass or solid. */
  glass: boolean;
  float?: Rect;
  /** The width of the left or right dock. */
  sideWidth: number;
  /** The height of the bottom dock. */
  bottomHeight: number;
  logo?: Point;
  modelPanes: ModelPanes;
};

export const defaultPreferences: Preferences = {
  layout: "float",
  collapsed: false,
  theme: "system",
  glass: true,
  sideWidth: 640,
  bottomHeight: 360,
  modelPanes: { objectsOpen: true, modelsOpen: true, split: 0.58 },
};

const layouts: readonly Layout[] = ["float", "left", "right", "bottom"];
const themes: readonly ThemePreference[] = ["system", "light", "dark"];

/**
 * The preferences in a stored value. Each value that is missing or malformed
 * falls back to its default, as does everything when nothing usable is
 * stored.
 */
export function decodePreferences(stored: unknown): Preferences {
  if (!isRecord(stored)) return defaultPreferences;

  return {
    layout: oneOf(stored.layout, layouts) ?? defaultPreferences.layout,
    collapsed:
      typeof stored.collapsed === "boolean"
        ? stored.collapsed
        : defaultPreferences.collapsed,
    theme: oneOf(stored.theme, themes) ?? defaultPreferences.theme,
    glass:
      typeof stored.glass === "boolean"
        ? stored.glass
        : defaultPreferences.glass,
    float: isRect(stored.float) ? pick(stored.float, rectKeys) : undefined,
    sideWidth: isSize(stored.sideWidth)
      ? stored.sideWidth
      : defaultPreferences.sideWidth,
    bottomHeight: isSize(stored.bottomHeight)
      ? stored.bottomHeight
      : defaultPreferences.bottomHeight,
    logo: isPoint(stored.logo) ? pick(stored.logo, pointKeys) : undefined,
    modelPanes: readModelPanes(stored.modelPanes),
  };
}

function readModelPanes(stored: unknown): ModelPanes {
  const defaults = defaultPreferences.modelPanes;
  if (!isRecord(stored)) return defaults;
  const open = (value: unknown, fallback: boolean) =>
    typeof value === "boolean" ? value : fallback;
  return {
    objectsOpen: open(stored.objectsOpen, defaults.objectsOpen),
    modelsOpen: open(stored.modelsOpen, defaults.modelsOpen),
    split:
      isFiniteNumber(stored.split) &&
      stored.split >= minModelSplit &&
      stored.split <= maxModelSplit
        ? stored.split
        : defaults.split,
  };
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
