import { renderInspector } from "./renderInspector";
import { exposeInspectorShadowRoot } from "../shared";

/**
 * Mounts the Inspector into the window it owns (ADR-0049): the external
 * placement, in a page that `ayme mcp` serves. It fills the window, and shows
 * a page that is not this document, so it hears none of its DOM events: the
 * contract client it reads through is the channel's (`external`).
 */
export function mountExternalInspector() {
  const host = document.createElement("ayme-inspector");
  host.dataset.aymeInspectorHost = "";
  // Closed, as inline: tests reach the root through the hook.
  const shadowRoot = host.attachShadow({ mode: "closed" });
  exposeInspectorShadowRoot(host, shadowRoot);
  document.body.append(host);
  const unmount = renderInspector(shadowRoot, { windowed: true });
  return {
    dispose() {
      unmount();
      host.remove();
    },
  };
}
