import { createRuntimeSession, type PomManifest } from "@ayme-dev/webmcp";
import {
  registerCompiledPom,
  type PageObjectConstructor,
} from "@ayme-dev/webmcp/internal";
import { mountInspector } from "@ayme-dev/webmcp-inspector";

import { ListPage } from "./ListPage";

// What the Ayme compiler derives from ListPage.ts. The fixture registers it
// by hand: the compiler's bundler plugin depends on this package.
const listPageManifest: PomManifest = {
  className: "ListPage",
  members: [
    { memberName: "newItemInput", kind: "locator", access: "field" },
    { memberName: "addItemButton", kind: "locator", access: "field" },
    { memberName: "items", kind: "locator", access: "field" },
  ],
  components: [],
  tools: [
    {
      methodName: "addItem",
      toolName: "ListPage.addItem",
      description: "Add an item to the list.",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
      parameters: [
        { name: "text", optional: false, schema: { type: "string" } },
      ],
    },
  ],
};

registerCompiledPom(ListPage, listPageManifest);

/**
 * Mounts the Inspector, then starts the runtime with a Page Object (the
 * ListPage by default), the way the Ayme integrations do. The page reports its state on
 * <html> so the e2e tests can tell a broken fixture or a runtime that never
 * published from a broken Inspector.
 */
export function startAyme(PageObject: PageObjectConstructor = ListPage) {
  const root = document.documentElement.dataset;
  try {
    const inspector = mountInspector();
    const runtime = createRuntimeSession();
    const unregister = runtime.register(
      PageObject,
      runtime.construct(PageObject)
    );
    const reportRuntime = () => {
      const { state, message } = runtime.getSnapshot();
      root.runtime = state;
      root.runtimeMessage = message;
    };
    const unsubscribe = runtime.subscribe(reportRuntime);
    const stop = runtime.start();
    reportRuntime();
    root.fixture = "ready";
    return () => {
      unregister();
      stop();
      unsubscribe();
      inspector.dispose();
    };
  } catch (error) {
    root.fixture = "failed";
    root.fixtureError = error instanceof Error ? error.message : String(error);
    throw error;
  }
}
