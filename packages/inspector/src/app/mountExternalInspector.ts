import { renderInspector } from "./renderInspector";
import type { WindowFullscreen } from "../panel/domain";
import { exposeInspectorShadowRoot } from "../shared/infrastructure";

/**
 * Mounts the Inspector into the window it owns (ADR-0049), in a page a
 * Session's process serves. It fills the window, and shows a page that is
 * not this document, so it hears none of its DOM events: the contract client
 * it reads through is the channel's (`external`). Shown in an Agent App's
 * chat, it offers the `fullscreen` the Agent App offers.
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
  const unmount = renderInspector(shadowRoot, { windowed: true, fullscreen });
  return {
    dispose() {
      unmount();
      host.remove();
    },
  };
}

/** What the Inspector of the Session named `name` says once it can no
 * longer reach it: in a window, or in an Agent App's chat. */
export const sessionLost = (name: string, inChat: boolean): string =>
  `This Inspector lost the Session ${name}. Start it again with ayme -s=${name} open, then ${inChat ? "ask your agent to show the Inspector again" : `run ayme -s=${name} inspect`}.`;

/**
 * Says `text` in place of the Inspector, such as that the Session this
 * window read through is gone. In the system's colours: the window may be an
 * Agent App's frame, light or dark.
 */
export function showServerLost(text: string) {
  const notice = document.createElement("p");
  notice.setAttribute("role", "status");
  notice.textContent = text;
  notice.style.cssText =
    "margin:0;padding:16px;font:14px system-ui,sans-serif;color-scheme:light dark;background:Canvas;color:CanvasText";
  document.body.append(notice);
}
