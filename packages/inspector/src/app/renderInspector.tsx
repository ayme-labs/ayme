import { renderInShadowRoot } from "../shared/infrastructure/renderInShadowRoot";
import { InspectorApp } from "./InspectorApp";

/**
 * Renders the Inspector into a shadow root with its compiled stylesheet.
 * React and the stylesheet stay inside the shadow root: nothing is added to
 * the host document's head, and the host's own React, if any, is untouched.
 */
export function renderInspector(shadowRoot: ShadowRoot) {
  return renderInShadowRoot(shadowRoot, <InspectorApp />);
}
