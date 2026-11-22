import { renderInspector } from "./renderInspector";
import type { WindowFullscreen } from "../panel";
import { exposeInspectorShadowRoot } from "../shared";

/**
 * Mounts the Inspector into the window it owns (ADR-0049): the external
 * placement, in a page that `ayme mcp` serves. It fills the window, and shows
 * a page that is not this document, so it hears none of its DOM events: the
 * contract client it reads through is the channel's (`external`). Shown in
 * an Agent App's chat, it offers the `fullscreen` the Agent App offers.
 */
export function mountExternalInspector({
  fullscreen,
}: { fullscreen?: WindowFullscreen } = {}) {
  const host = document.createElement("ayme-inspector");
  host.dataset.aymeInspectorHost = "";
  // Closed, as inline: tests reach the root through the hook.
  const shadowRoot = host.attachShadow({ mode: "closed" });
  exposeInspectorShadowRoot(host, shadowRoot);
  document.body.append(host);
  const unmount = renderInspector(shadowRoot, {
    windowed: true,
    fullscreen,
  });
  return {
    dispose() {
      unmount();
      host.remove();
    },
  };
}

/** What a window says once its server is gone for good. */
export const SERVER_LOST_NOTICE =
  "This Inspector lost its ayme MCP server. Ask the agent to open the Inspector again.";

/**
 * Says, in place of the Inspector, that the server this window read through
 * is gone. In the system's colours: the window is an Agent App's frame,
 * light or dark.
 */
export function showServerLost() {
  const notice = document.createElement("p");
  notice.setAttribute("role", "status");
  notice.textContent = SERVER_LOST_NOTICE;
  notice.style.cssText =
    "margin:0;padding:16px;font:14px system-ui,sans-serif;color-scheme:light dark;background:Canvas;color:CanvasText";
  document.body.append(notice);
}
