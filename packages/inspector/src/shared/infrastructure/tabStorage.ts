import { useEffect, useState } from "react";

/** The part of a tab's storage this module uses. */
type TabStorage = Pick<Storage, "getItem" | "setItem">;

/**
 * The storage of the tab of `browser`: it outlives a reload and ends with
 * the tab. Nothing when the browser denies access to it.
 */
export function tabStorage(
  browser: { readonly sessionStorage: TabStorage } = window
): TabStorage | undefined {
  try {
    return browser.sessionStorage;
  } catch {
    return undefined;
  }
}

/** The stored value under a key, or `undefined` when there is none to read. */
export function readStored(
  storage: TabStorage | undefined,
  key: string
): unknown {
  try {
    const text = storage?.getItem(key);
    return text ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
}

/** Stores a value. Without usable storage, it lasts for the page. */
export function writeStored(
  storage: TabStorage | undefined,
  key: string,
  value: unknown
) {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {
    // Storage is full, blocked or gone: keep the value in memory only.
  }
}

/**
 * State that survives a reload in this tab: read from the tab's storage once,
 * through `decode`, and written back, through `encode`, on every change.
 */
export function useTabState<T>(
  key: string,
  decode: (stored: unknown) => T,
  encode: (value: T) => unknown = (value) => value
) {
  const [storage] = useState(tabStorage);
  const [value, setValue] = useState(() => decode(readStored(storage, key)));
  useEffect(() => {
    writeStored(storage, key, encode(value));
  }, [storage, key, value, encode]);
  return [value, setValue] as const;
}
