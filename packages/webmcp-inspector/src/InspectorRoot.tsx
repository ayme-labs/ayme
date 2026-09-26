import { useState, type ReactNode } from "react";

import { PortalContainerProvider } from "@ayme-dev/design-system/lib/portal-container";
import { cn } from "@ayme-dev/design-system/lib/utils";

/**
 * The Inspector's themed root inside its shadow root. Popovers and menus
 * portal into a container inside it, so they pick up its styles and theme.
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
  return (
    <div
      data-ayme-inspector-root
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
