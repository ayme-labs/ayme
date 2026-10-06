import {
  createAyme,
  type DecisionRequest,
  type DecisionResponse,
  type CustomTool,
} from "@ayme-dev/ayme";
import type { PageObjectConstructor } from "@ayme-dev/ayme/internal";
import {
  INSPECTOR_STRUCTURE_TREE_ATTRIBUTE,
  mountInspector,
} from "@ayme-dev/inspector";

import { ListPage } from "../pom/ListPage";

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
      model: "typesafe/jev-1.13",
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
 * ListPage by default), the way the Ayme integrations do. `mount: "after"`
 * mounts the Inspector once the runtime started with its Page Object, and
 * `mount: "session"` leaves it to the session's `inspector` option. `demo`
 * mounts it in demo mode. `dogfood` mounts it for dogfooding, turns the
 * Agent Connection on and registers `alsoRegister`, the Inspector's own
 * Page Object compiled by the plugin. The page
 * reports its state on <html> so the e2e tests can tell a broken fixture or a
 * runtime that never published from a broken Inspector.
 */
const isInspectorStructureTree = (element: Element) =>
  element.hasAttribute(INSPECTOR_STRUCTURE_TREE_ATTRIBUTE);

export function startAyme({
  PageObject = ListPage,
  publish = true,
  mount = "before",
  demo = false,
  dogfood = false,
  alsoRegister = [],
}: {
  PageObject?: PageObjectConstructor;
  publish?: boolean;
  mount?: "before" | "after" | "session";
  demo?: boolean;
  dogfood?: boolean;
  alsoRegister?: readonly PageObjectConstructor[];
} = {}) {
  const root = document.documentElement.dataset;
  try {
    let inspector =
      mount === "before" ? mountInspector({ demo, dogfood }) : undefined;
    const runtime = createAyme({
      customTools: [markElement],
      goalLoop: clearTheList(),
      webMCP: { enabled: publish },
      inspector: mount === "session" && (demo ? { demo } : true),
      agentConnection: dogfood,
      // The Structure lens renders the page state; in page state it would
      // render itself, over and over.
      ignore: dogfood ? isInspectorStructureTree : undefined,
    });
    runtime.pom.register(PageObject);
    for (const Other of alsoRegister) runtime.pom.register(Other);
    const reportRuntime = () => {
      const { state, message } = runtime.webMCP.publicationStatus;
      root.runtime = state;
      root.runtimeMessage = message;
    };
    const unsubscribe = runtime.webMCP.subscribe(reportRuntime);
    const stop = runtime.start();
    if (mount === "after") inspector = mountInspector({ demo });
    reportRuntime();
    root.fixture = "ready";
    return () => {
      for (const Other of alsoRegister) runtime.pom.unregister(Other);
      runtime.pom.unregister(PageObject);
      stop();
      unsubscribe();
      inspector?.dispose();
    };
  } catch (error) {
    root.fixture = "failed";
    root.fixtureError = error instanceof Error ? error.message : String(error);
    throw error;
  }
}
