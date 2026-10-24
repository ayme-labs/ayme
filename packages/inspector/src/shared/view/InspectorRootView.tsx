import { useState, type ReactNode, type Ref } from "react";

import { PortalContainerProvider } from "@ayme-dev/design-system/lib/portal-container";
import { cn } from "@ayme-dev/design-system/lib/utils";

/**
 * The Inspector's themed root. Popovers and menus portal into a container
 * inside it, so they pick up its styles and theme. While it's `switching`
 * between light and dark, it's marked so the panel's surfaces ease across
 * (inspector.css).
 */
export function InspectorRootView({
  rootRef,
  dark,
  switching,
  children,
}: {
  rootRef: Ref<HTMLDivElement>;
  dark: boolean;
  switching: boolean;
  children: ReactNode;
}) {
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(
    null
  );
  return (
    <div
      ref={rootRef}
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
