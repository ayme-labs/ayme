import { EXCLUDE_ATTRIBUTE } from "@ayme-dev/ayme/inspector";

import { renderInspector } from "./renderInspector";
import { exposeInspectorShadowRoot, inspectorClient } from "../shared";

export type InspectorOptions = {
  /**
   * Asks the runtime for Demo Mode while the panel is mounted: it pauses
   * before each action and shows a cue where a click lands, for every call,
   * whoever makes it. Off by default: calls run at full speed.
   */
  demo?: boolean;
  /**
   * Dogfooding: mounts the panel in an open shadow root, so the runtime's
   * page state and locators see it like any part of the page. With the
   * Inspector's own Page Object registered, agents drive the panel through
   * Page Object Tools. Off by default: the root is closed and the panel
   * stays out of what agents see.
   */
  dogfood?: boolean;
};

type MountedInspector = {
  references: number;
  disposeUi: () => void;
};

let mounted: MountedInspector | undefined;

/**
 * Mounts the Inspector once per document; each call returns its own dispose.
 * The first of overlapping mounts decides `demo` and `dogfood`. Demo Mode
 * is the runtime's: the panel only asks for it.
 */
export function mountInspector(options: InspectorOptions = {}) {
  if (!mounted) {
    // A custom element name, so the page's `div` rules and queries miss the
    // host. It needs no registration to host a shadow root.
    const host = document.createElement("ayme-inspector");
    host.dataset.aymeInspectorHost = "";
    host.style.pointerEvents = "none";
    // Closed, so the host page's locators never match the Inspector's own
    // text, and marked as an excluded subtree, so the runtime's capture,
    // Reach and screenshots leave it out. Tests reach the root through the
    // hook. Open and unmarked when dogfooding: the runtime's page state keeps
    // it then.
    if (!options.dogfood) host.setAttribute(EXCLUDE_ATTRIBUTE, "");
    const shadowRoot = host.attachShadow({
      mode: options.dogfood ? "open" : "closed",
    });
    exposeInspectorShadowRoot(host, shadowRoot);
    document.body.append(host);
    const unmountUi = renderInspector(shadowRoot);
    const askForDemo = (on: boolean) =>
      void inspectorClient()
        .demo(on)
        .catch(() => {});
    if (options.demo) askForDemo(true);
    mounted = {
      references: 0,
      disposeUi() {
        if (options.demo) askForDemo(false);
        unmountUi();
        host.remove();
      },
    };
  }

  const instance = mounted;
  instance.references += 1;
  let disposed = false;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      instance.references -= 1;
      if (instance.references !== 0 || mounted !== instance) return;
      instance.disposeUi();
      mounted = undefined;
    },
  };
}
