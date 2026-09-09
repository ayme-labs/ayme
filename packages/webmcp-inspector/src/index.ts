import type { Page } from "@playwright/test";
import { installRuntimePageInstrumentation } from "@ayme-dev/webmcp/internal";
import { createApp } from "vue";

import InspectorApp from "./InspectorApp.vue";
import { recordInspectorTrace, resetInspectorTrace } from "./trace";
import {
  removeDemoFeedbackListener,
  withDemoFeedback,
} from "./withDemoFeedback";

export function installInspectorInstrumentation() {
  resetInspectorTrace();
  const instrumentedPages = new Set<Page>();
  const onTrace = (entry: Parameters<typeof recordInspectorTrace>[0]) =>
    recordInspectorTrace(entry);
  const uninstall = installRuntimePageInstrumentation((page) => {
    const instrumentedPage = withDemoFeedback(page as Page, { onTrace });
    instrumentedPages.add(instrumentedPage);
    return instrumentedPage;
  });

  return () => {
    uninstall();
    for (const page of instrumentedPages)
      removeDemoFeedbackListener(page, onTrace);
    instrumentedPages.clear();
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
    const host = document.createElement("div");
    host.dataset.aymeInspectorHost = "";
    host.style.pointerEvents = "none";
    const shadowRoot = host.attachShadow({ mode: "open" });
    const container = document.createElement("div");
    shadowRoot.append(container);
    document.body.append(host);
    const app = createApp(InspectorApp);
    app.mount(container);
    mounted = {
      references: 0,
      disposeInstrumentation,
      disposeUi() {
        app.unmount();
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
      instance.disposeInstrumentation();
      mounted = undefined;
    },
  };
}

export { getInspectorTrace } from "./trace";
export type { TraceEntry } from "./trace";
