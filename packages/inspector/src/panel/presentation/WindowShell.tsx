import type { ReactNode } from "react";

import type { ThemePreference } from "../domain/preferences";
import { Header } from "../view/Header";

/**
 * The shell of an Inspector that has a window of its own (ADR-0049): the
 * panel fills it, with the same header and body, and nothing to drag, dock,
 * resize or collapse. Its structure is the shell's: an `ayme` landmark
 * holding a frame that holds the header and the body.
 */
export function WindowShell({
  theme,
  onThemeChange,
  status,
  children,
}: {
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  /** What the header shows after its title. */
  status?: ReactNode;
  children: ReactNode;
}) {
  return (
    <aside
      aria-label="ayme"
      className="@container pointer-events-auto fixed inset-0 bg-background"
    >
      <div className="flex size-full flex-col overflow-hidden bg-background">
        <Header
          status={status}
          layout="bottom"
          theme={theme}
          onThemeChange={onThemeChange}
        />
        {children}
      </div>
    </aside>
  );
}
