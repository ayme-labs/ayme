import { Button } from "@ayme-dev/design-system/components/button";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";

import { nextTheme, THEME_LABELS, type ThemePreference } from "../domain/theme";

const ICONS = { system: MonitorIcon, light: SunIcon, dark: MoonIcon };

/** The System / Light / Dark switch, as the Inspector's: each press moves
 * to the next one. */
export function ThemeSwitch({
  preference,
  onChange,
}: {
  preference: ThemePreference;
  onChange: (preference: ThemePreference) => void;
}) {
  const Icon = ICONS[preference];
  const next = nextTheme(preference);
  const name = `Theme: ${THEME_LABELS[preference]}. Switch to ${THEME_LABELS[next]}.`;
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8"
      aria-label={name}
      title={name}
      onClick={() => onChange(next)}
    >
      <Icon />
    </Button>
  );
}
