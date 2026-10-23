import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { PortalContainerProvider } from "@ayme-dev/design-system/lib/portal-container";
import { cn } from "@ayme-dev/design-system/lib/utils";

/**
 * The Inspector's themed root inside its shadow root. Popovers and menus
 * portal into a container inside it, so they pick up its styles and theme.
 * Switching between light and dark eases the panel's surfaces across rather
 * than flashing them (inspector.css): the root is marked from the switch
 * until the transitions it started have settled, so the panel's own
 * transitions apply again after.
 */
export function InspectorRoot({
  dark,
  children,
}: {
  dark: boolean;
  children: ReactNode;
}) {
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(
    null
  );
  // Marked in the render that switches, so the colours change with the
  // transitions already on.
  const root = useRef<HTMLDivElement>(null);
  const [shownDark, setShownDark] = useState(dark);
  const [switching, setSwitching] = useState(false);
  if (dark !== shownDark) {
    setShownDark(dark);
    setSwitching(true);
  }
  useLayoutEffect(() => {
    const element = root.current;
    if (!switching || !element) return;
    let current = true;
    const transitions = element
      .getAnimations({ subtree: true })
      .filter((animation) => animation instanceof CSSTransition);
    void Promise.allSettled(transitions.map(({ finished }) => finished)).then(
      () => {
        if (current) setSwitching(false);
      }
    );
    return () => {
      current = false;
    };
  }, [switching, shownDark]);

  return (
    <div
      ref={root}
      data-ayme-inspector-root
      data-theme-switching={switching || undefined}
      className={cn(
        "font-sans text-sm text-foreground antialiased",
        dark ? "dark scheme-dark" : "scheme-light"
      )}
    >
      <PortalContainerProvider value={portalContainer}>
        {children}
        <div
          ref={setPortalContainer}
          className="pointer-events-auto"
          data-ayme-inspector-portal
        />
      </PortalContainerProvider>
    </div>
  );
}
