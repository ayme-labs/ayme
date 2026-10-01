import type { ReactNode } from "react";

import { InspectorRoot } from "./InspectorRoot";
import { renderInShadowRoot } from "./renderInspector";

/**
 * Component-test support: renders one part of the panel with fixture props
 * the way the Inspector renders itself, with the compiled stylesheet and the
 * themed root, but in an open shadow root so playwright-lite's locators reach
 * it (the mounted Inspector's root is closed). Returns the unmount function.
 */
export function renderPart(node: ReactNode, { dark = false } = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const unmount = renderInShadowRoot(
    host.attachShadow({ mode: "open" }),
    <InspectorRoot dark={dark}>{node}</InspectorRoot>
  );
  return () => {
    unmount();
    host.remove();
  };
}
