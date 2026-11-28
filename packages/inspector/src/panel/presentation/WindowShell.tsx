import { useSyncExternalStore, type ReactNode } from "react";

import type { FullscreenState, WindowFullscreen } from "../domain/fullscreen";
import type { ThemePreference } from "../domain/preferences";
import { Header } from "../view/Header";

/**
 * The shell of an Inspector that has a window of its own (ADR-0049): the
 * panel fills it, with the same header and body, and nothing to drag, dock,
 * resize or collapse. Its structure is the shell's: an `ayme` landmark
 * holding a frame that holds the header and the body. Where the window is
 * shown in an Agent App's chat, the header has a fullscreen control while
 * the Agent App offers fullscreen.
 */
export function WindowShell({
  theme,
  onThemeChange,
  fullscreen,
  children,
}: {
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  fullscreen?: WindowFullscreen;
  children: ReactNode;
}) {
  const { offered, active } = useSyncExternalStore(
    fullscreen?.subscribe ?? never,
    fullscreen?.current ?? notOffered
  );
  return (
    <aside
      aria-label="ayme"
      className="@container pointer-events-auto fixed inset-0 bg-background"
    >
      <div className="flex size-full flex-col overflow-hidden bg-background">
        <Header
          layout="bottom"
          theme={theme}
          onThemeChange={onThemeChange}
          fullscreen={
            offered && fullscreen
              ? { active, onToggle: fullscreen.toggle }
              : undefined
          }
        />
        {children}
      </div>
    </aside>
  );
}

const offNone: FullscreenState = { offered: false, active: false };
const notOffered = () => offNone;
const never = () => () => {};
