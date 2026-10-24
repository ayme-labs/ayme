import type { ReactNode } from "react";

import { InspectorRootView } from "../view/InspectorRootView";
import { useThemeSwitch } from "./useThemeSwitch";

/**
 * The Inspector's themed root inside its shadow root. Switching between
 * light and dark eases the panel's surfaces across rather than flashing
 * them (inspector.css): the root is marked from the switch until the
 * transitions it started have settled.
 */
export function InspectorRoot({
  dark,
  children,
}: {
  dark: boolean;
  children: ReactNode;
}) {
  const { root, switching } = useThemeSwitch(dark);
  return (
    <InspectorRootView rootRef={root} dark={dark} switching={switching}>
      {children}
    </InspectorRootView>
  );
}
