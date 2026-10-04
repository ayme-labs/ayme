import type { Page } from "@playwright/test";
import { installRuntimePageInstrumentation } from "@ayme-dev/ayme/internal";

import { allowPassThrough } from "../panel";
import { renderInspector } from "./renderInspector";
import { exposeInspectorShadowRoot } from "../shared";
import {
  dispatchInspectorTrace,
  recordInspectorTrace,
  resetInspectorTrace,
  subscribeToInspectorTraceDispatcher,
} from "../runs";
import { withDemoFeedback } from "../demo";

// The page's two highlights: solid for the Inspector's selection, dashed
// for what the pointer is over in the panel. An element that is both shows
// the selection's.
const highlightStyleText = `
[data-ayme-highlight] {
  animation: ayme-highlight-pulse 1.6s ease-in-out infinite;
  outline: 3px solid #d9a441;
  outline-offset: 3px;
  position: relative;
  z-index: 1;
}

[data-ayme-hover]:not([data-ayme-highlight]) {
  outline: 2px dashed #d9a441;
  outline-offset: 3px;
}

@keyframes ayme-highlight-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgb(217 164 65 / 0%);
  }
  50% {
    box-shadow: 0 0 0 5px rgb(217 164 65 / 18%);
  }
}

@media (prefers-reduced-motion: reduce) {
  [data-ayme-highlight] {
    animation: none;
  }
}
`;

export function installInspectorInstrumentation() {
  resetInspectorTrace();
  const unsubscribeFromTrace =
    subscribeToInspectorTraceDispatcher(recordInspectorTrace);
  const uninstall = installRuntimePageInstrumentation((page) => {
    return withDemoFeedback(page as Page, {
      onTrace: dispatchInspectorTrace,
      clickCue: true,
    });
  });

  return () => {
    uninstall();
    unsubscribeFromTrace();
  };
}

type MountedInspector = {
  references: number;
  disposeInstrumentation: () => void;
  disposeUi: () => void;
};

let mounted: MountedInspector | undefined;

export function mountInspector() {
  if (!mounted) {
    const disposeInstrumentation = installInspectorInstrumentation();
    const highlightStyle = document.createElement("style");
    highlightStyle.dataset.aymeInspectorHighlightStyle = "";
    highlightStyle.textContent = highlightStyleText;
    document.head.append(highlightStyle);
    // A custom element name, so the page's `div` rules and queries miss the
    // host. It needs no registration to host a shadow root.
    const host = document.createElement("ayme-inspector");
    host.dataset.aymeInspectorHost = "";
    host.style.pointerEvents = "none";
    // Closed, so the host page's locators and page-state capture never match
    // the Inspector's own text. Tests reach the root through the hook.
    const shadowRoot = host.attachShadow({ mode: "closed" });
    exposeInspectorShadowRoot(host, shadowRoot);
    document.body.append(host);
    const unmountUi = renderInspector(shadowRoot);
    const disallowPassThrough = allowPassThrough(shadowRoot);
    mounted = {
      references: 0,
      disposeInstrumentation,
      disposeUi() {
        disallowPassThrough();
        unmountUi();
        host.remove();
        highlightStyle.remove();
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
      instance.disposeInstrumentation();
      mounted = undefined;
    },
  };
}
