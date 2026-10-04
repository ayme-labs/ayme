import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import inspectorCss from "virtual:ayme-inspector-css";

/**
 * Renders a node into a shadow root with the Inspector's compiled
 * stylesheet. React and the stylesheet stay inside the shadow root.
 */
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
