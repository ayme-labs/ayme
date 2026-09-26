import { Button } from "@ayme-dev/design-system/components/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@ayme-dev/design-system/components/popover";

import type { ThemePreference } from "./useTheme";

const preferences: readonly { value: ThemePreference; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function ThemeMenu({
  preference,
  onChange,
}: {
  preference: ThemePreference;
  onChange: (preference: ThemePreference) => void;
}) {
  const current = preferences.find(({ value }) => value === preference);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost">
          Theme: {current?.label}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="grid w-32 gap-1 p-1"
        data-theme-menu
      >
        {preferences.map(({ value, label }) => (
          <Button
            key={value}
            size="sm"
            variant={value === preference ? "secondary" : "ghost"}
            className="justify-start"
            aria-pressed={value === preference}
            onClick={() => onChange(value)}
          >
            {label}
          </Button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
