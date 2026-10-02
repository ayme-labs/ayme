import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import inspectorCss from "virtual:ayme-inspector-css";

import { InspectorApp } from "./InspectorApp";

/**
 * Renders the Inspector into a shadow root with its compiled stylesheet.
 * React and the stylesheet stay inside the shadow root: nothing is added to
 * the host document's head, and the host's own React, if any, is untouched.
 */
export function renderInspector(shadowRoot: ShadowRoot) {
  return renderInShadowRoot(shadowRoot, <InspectorApp />);
}

/** Renders a node into a shadow root the way {@link renderInspector} does. */
export function renderInShadowRoot(shadowRoot: ShadowRoot, node: ReactNode) {
  const style = document.createElement("style");
  style.dataset.aymeInspectorStyle = "";
  style.textContent = inspectorCss;
  const container = document.createElement("div");
  shadowRoot.append(style, container);

  const root = createRoot(container);
  // Render synchronously so the Inspector is in place when mount returns.
  flushSync(() => root.render(node));

  return () => {
    root.unmount();
    style.remove();
    container.remove();
  };
}
