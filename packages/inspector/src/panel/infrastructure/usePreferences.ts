import { useCallback, useEffect, useState } from "react";

import type { Preferences } from "../domain/preferences";
import {
  browserStorage,
  readPreferences,
  writePreferences,
} from "./preferencesStorage";

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
