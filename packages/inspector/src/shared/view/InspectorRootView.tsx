import type { ReactNode, Ref } from "react";

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
  portalContainer,
  portalRef,
  children,
}: {
  rootRef: Ref<HTMLDivElement>;
  dark: boolean;
  switching: boolean;
  /** The container popovers and menus portal into, once it's mounted. */
  portalContainer: HTMLElement | null;
  portalRef: Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  return (
    <div
      ref={rootRef}
      data-ayme-inspector-root
      data-theme-switching={switching || undefined}
      className={cn(
        // Stryker disable next-line StringLiteral: Tailwind classes are styling, which no test reads.
        "font-sans text-sm text-foreground antialiased",
        dark
          ? "dark scheme-dark"
          : // Stryker disable next-line StringLiteral: the host resets the page's colour scheme, so the light one shows as none does.
            "scheme-light"
      )}
    >
      <PortalContainerProvider value={portalContainer}>
        {children}
        <div
          ref={portalRef}
          className="pointer-events-auto"
          data-ayme-inspector-portal
        />
      </PortalContainerProvider>
    </div>
  );
}
