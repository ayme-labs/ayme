import { useState } from "react";

import { InspectorShell } from "./InspectorShell";
import { defaultPreferences, type Preferences } from "./preferences";

/**
 * Component-test support: the shell holding its own preferences, the way
 * the Inspector holds them, so a test can drive it and watch the panel move.
 */
export function ShellHarness({ initial }: { initial?: Partial<Preferences> }) {
  const [preferences, setPreferences] = useState<Preferences>({
    ...defaultPreferences,
    ...initial,
  });
  return (
    <InspectorShell
      preferences={preferences}
      onPreferencesChange={(patch) =>
        setPreferences((current) => ({ ...current, ...patch }))
      }
      pageName="ListPage"
    >
      <p>The body</p>
    </InspectorShell>
  );
}
