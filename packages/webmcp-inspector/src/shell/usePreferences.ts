import { useCallback, useEffect, useState } from "react";

import {
  browserStorage,
  readPreferences,
  writePreferences,
  type Preferences,
} from "./preferences";

/**
 * The panel's preferences, read from this site's storage once and written
 * back on every change.
 */
export function usePreferences() {
  const [storage] = useState(browserStorage);
  const [preferences, setPreferences] = useState(() =>
    readPreferences(storage)
  );
  useEffect(() => {
    writePreferences(storage, preferences);
  }, [storage, preferences]);
  const update = useCallback(
    (patch: Partial<Preferences>) =>
      setPreferences((current) => ({ ...current, ...patch })),
    []
  );
  return [preferences, update] as const;
}
