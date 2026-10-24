import { useState, type ReactNode } from "react";

import { InspectorRootView } from "../view/InspectorRootView";
import { useThemeSwitch } from "./useThemeSwitch";

/**
 * The Inspector's themed root inside its shadow root. Switching between
 * light and dark eases the panel's surfaces across rather than flashing
 * them (inspector.css): the root is marked from the switch until the
 * transitions it started have settled. Popovers and menus portal into the
 * container the view mounts inside it.
 */
export function InspectorRoot({
  dark,
  children,
}: {
  dark: boolean;
  children: ReactNode;
}) {
  const { root, switching } = useThemeSwitch(dark);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(
    null
  );
  return (
    <InspectorRootView
      rootRef={root}
      dark={dark}
      switching={switching}
      portalContainer={portalContainer}
      portalRef={setPortalContainer}
    >
      {children}
    </InspectorRootView>
  );
}
