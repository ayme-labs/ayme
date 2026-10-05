import { useState, type ReactNode } from "react";

import { PortalContainerProvider } from "@ayme-dev/design-system/lib/portal-container";
import { cn } from "@ayme-dev/design-system/lib/utils";

/**
 * The Inspector's themed root inside its shadow root. Popovers and menus
 * portal into a container inside it, so they pick up its styles, its theme
 * and its glass look.
 */
export function InspectorRoot({
  dark,
  glass,
  children,
}: {
  dark: boolean;
  glass: boolean;
  children: ReactNode;
}) {
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(
    null
  );
  return (
    <div
      data-ayme-inspector-root
      data-glass={glass || undefined}
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
