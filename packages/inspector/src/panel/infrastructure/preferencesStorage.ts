import { decodePreferences, type Preferences } from "../domain/preferences";

/** Browser storage is per origin, so the preferences are per site. */
export const preferencesKey = "ayme-inspector:preferences";

/**
 * Reads the stored preferences. Each value that is missing, malformed or
 * unreadable falls back to its default, as does everything when storage is
 * unavailable.
 */
export function readPreferences(storage: Storage | undefined): Preferences {
  try {
    const text = storage?.getItem(preferencesKey);
    return decodePreferences(text ? JSON.parse(text) : undefined);
  } catch {
    return decodePreferences(undefined);
  }
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
