import { useState } from "react";

import { useHostReservation } from "../infrastructure/useHostReservation";
import { InspectorShell } from "../presentation/InspectorShell";
import { defaultPreferences, type Preferences } from "../domain/preferences";

/**
 * Component-test support: the shell holding its own preferences, the way
 * the Inspector holds them, so a test can drive it and watch the panel move.
 */
export function ShellHarness({ initial }: { initial?: Partial<Preferences> }) {
  const reserveHost = useHostReservation();
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
      reserveHost={reserveHost}
    >
      <p>The body</p>
    </InspectorShell>
  );
}
