import {
  createRuntimeSession,
  type DecisionRequest,
  type DecisionResponse,
  type PomManifest,
  type CustomTool,
} from "@ayme-dev/ayme";
import {
  registerCompiledPom,
  type PageObjectConstructor,
} from "@ayme-dev/ayme/internal";
import { mountInspector } from "@ayme-dev/inspector";

import { ListPage } from "./ListPage";

// What the Ayme compiler derives from ListPage.ts. The fixture registers it
// by hand: the compiler's bundler plugin depends on this package.
const listPageManifest: PomManifest = {
  className: "ListPage",
  members: [
    { memberName: "newItemInput", kind: "locator", access: "field" },
    { memberName: "addItemButton", kind: "locator", access: "field" },
    { memberName: "clearButton", kind: "locator", access: "field" },
    { memberName: "items", kind: "locator", access: "field" },
    // The same elements as `items`, as Page Objects a collection action
    // runs on.
    {
      memberName: "entries",
      kind: "component",
      access: "method",
      componentClassName: "ListItem",
      collection: true,
    },
  ],
  components: [
    {
      className: "ListItem",
      members: [{ memberName: "root", kind: "locator", access: "field" }],
      tools: [
        {
          methodName: "mark",
          toolName: "ListItem.mark",
          description: "Mark this item done or to do.",
          inputSchema: {
            type: "object",
            properties: { state: { type: "string", enum: ["done", "todo"] } },
            required: ["state"],
            additionalProperties: false,
          },
          parameters: [
            {
              name: "state",
              optional: false,
              schema: { type: "string", enum: ["done", "todo"] },
            },
          ],
        },
      ],
    },
  ],
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
    {
      methodName: "countItems",
      toolName: "ListPage.countItems",
      description: "Count the items on the list.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
      parameters: [],
    },
    {
      methodName: "clear",
      toolName: "ListPage.clear",
      description: "Remove every item from the list.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
      parameters: [],
    },
  ],
};

registerCompiledPom(ListPage, listPageManifest);

/** A Custom Tool: it marks the element it's given. */
const markElement: CustomTool = {
  name: "mark_element",
  description: "Mark one element on the page.",
  async execute({ element }) {
    element.setAttribute("data-marked", "");
    return null;
  },
};

type Choice = { criteria?: Record<string, string> };

/**
 * A stubbed Goal Loop decision, so goal is published without a model:
 * the first step clears the list, the next one judges the goal met. It
 * stands in for the model's judgement, which no Inspector test depends on.
 */
function clearTheList() {
  let step = 0;
  return async (request: DecisionRequest): Promise<DecisionResponse> => {
    const { operation } = request.questions as { operation?: Choice };
    const choice = step++ === 0 ? "ListPage.clear" : "none";
    const keys = Object.keys(operation?.criteria ?? {});
    return {
      model: request.model,
      answers: {
        operation: {
          type: "choice",
          choice,
          confidence: 1,
          probabilities: Object.fromEntries(
            keys.map((key) => [key, key === choice ? 1 : 0])
          ),
        },
        goal_met: { type: "noul", noul: choice === "none" ? 0.9 : 0.1 },
      },
    };
  };
}

/**
 * Mounts the Inspector, then starts the runtime with a Page Object (the
 * ListPage by default), the way the Ayme integrations do. The page reports its state on
 * <html> so the e2e tests can tell a broken fixture or a runtime that never
 * published from a broken Inspector.
 */
export function startAyme({
  PageObject = ListPage,
  publish = true,
}: { PageObject?: PageObjectConstructor; publish?: boolean } = {}) {
  const root = document.documentElement.dataset;
  try {
    const inspector = mountInspector();
    const runtime = createRuntimeSession({
      customTools: [markElement],
      goalLoop: clearTheList(),
      webMCP: { enabled: publish },
    });
    const unregister = runtime.register(
      PageObject,
      runtime.construct(PageObject)
    );
    const reportRuntime = () => {
      const { state, message } = runtime.webMCP.publicationStatus;
      root.runtime = state;
      root.runtimeMessage = message;
    };
    const unsubscribe = runtime.webMCP.subscribe(reportRuntime);
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
