import type { ReactNode } from "react";

import { InspectorRoot } from "./InspectorRoot";
import { renderInShadowRoot } from "./renderInspector";

/**
 * Component-test support: renders one part of the panel with fixture props
 * the way the Inspector renders itself, in an open shadow root with the
 * compiled stylesheet and the themed root. The part takes pointer events,
 * as it does inside the panel. Returns the unmount function.
 */
export function renderPart(node: ReactNode, { dark = false } = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const unmount = renderInShadowRoot(
    host.attachShadow({ mode: "open" }),
    <InspectorRoot dark={dark}>
      <div className="pointer-events-auto">{node}</div>
    </InspectorRoot>
  );
  return () => {
    unmount();
    host.remove();
  };
}
