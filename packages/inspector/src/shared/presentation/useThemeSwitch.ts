import { useLayoutEffect, useRef, useState } from "react";

/**
 * Whether the Inspector's root is switching between light and dark, and the
 * ref for the root. It is from the render that switches, so the colours
 * change with the transitions already on, until the transitions the switch
 * started have settled, so the panel's own transitions apply again after.
 */
export function useThemeSwitch(dark: boolean) {
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
  return { root, switching };
}
