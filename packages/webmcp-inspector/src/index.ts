import type { Page } from "@playwright/test";
import { installRuntimePageInstrumentation } from "@ayme-dev/webmcp/internal";

import { renderInspector } from "./renderInspector";
import {
  dispatchInspectorTrace,
  recordInspectorTrace,
  resetInspectorTrace,
  subscribeToInspectorTraceDispatcher,
} from "./trace";
import { withDemoFeedback } from "./withDemoFeedback";

const highlightStyleText = `
[data-ayme-highlight] {
  animation: ayme-highlight-pulse 1.6s ease-in-out infinite;
  outline: 3px solid #d9a441;
  outline-offset: 3px;
  position: relative;
  z-index: 1;
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
    return withDemoFeedback(page as Page, { onTrace: dispatchInspectorTrace });
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
    const host = document.createElement("div");
    host.dataset.aymeInspectorHost = "";
    host.style.pointerEvents = "none";
    const shadowRoot = host.attachShadow({ mode: "open" });
    document.body.append(host);
    const unmountUi = renderInspector(shadowRoot);
    mounted = {
      references: 0,
      disposeInstrumentation,
      disposeUi() {
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

export { getInspectorTrace } from "./trace";
export type { TraceEntry } from "./trace";
