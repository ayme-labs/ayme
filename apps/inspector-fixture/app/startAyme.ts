import {
  createAyme,
  type Ayme,
  type DecisionRequest,
  type DecisionResponse,
  type CustomTool,
} from "@ayme-dev/ayme";
import type { PageObjectConstructor } from "@ayme-dev/ayme/internal";
import {
  INSPECTOR_PAGE_RENDERING_ATTRIBUTE,
  mountInspector,
} from "@ayme-dev/inspector";

import { ListPage } from "#pom/ListPage";

/** A Custom Tool: it marks the element it's given. */
const markElement: CustomTool = {
  name: "mark_element",
  description: "Mark one element on the page.",
  async execute({ locator }) {
    await locator.evaluate((element) =>
      element.setAttribute("data-marked", "")
    );
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
 * Whether the page was opened for the external placement (`?external`): its
 * runtime mounts no panel and serves the Inspector over the Agent Connection,
 * to the window `ayme mcp` serves. The end-to-end tests' second project opens
 * every fixture page this way.
 */
const external = new URLSearchParams(location.search).has("external");

/**
 * Whether the page was opened through a connect link for the inline
 * placement (`?agent`): its runtime turns the Agent Connection on, so the
 * agent's ayme MCP server lists the page's tools.
 */
const connected = new URLSearchParams(location.search).has("agent");

declare global {
  interface Window {
    /**
     * The page's runtime, which the end-to-end tests read and run tools on
     * as the app does: the Browser Tools and snapshot, which no agent's ayme
     * MCP server lists, and the live tool list.
     */
    fixtureAyme?: Ayme;
  }
}

const rendersThePage = `[${INSPECTOR_PAGE_RENDERING_ATTRIBUTE}]`;

/**
 * Mounts the Inspector, then starts the runtime with a Page Object (the
 * ListPage by default), the way the ayme integrations do. `mount: "after"`
 * mounts the Inspector once the runtime started with its Page Object, and
 * `mount: "session"` leaves it to the session's `inspector` option. `demo`
 * mounts it in demo mode. `dogfood` mounts it for dogfooding, turns the
 * Agent Connection on and registers `alsoRegister`, the Inspector's own
 * Page Object compiled by the plugin. With `?external` in its address, the page
 * mounts no Inspector and its session has the external placement, in demo mode
 * with `demo`; with `?agent`, the Agent Connection is on. The page
 * reports whether it started on <html>, and its runtime on `window`, so the
 * e2e tests can tell a broken fixture or a runtime that never listed its
 * tools from a broken Inspector.
 */
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
      mount === "before" && !external
        ? mountInspector({ demo, dogfood })
        : undefined;
    const runtime = createAyme({
      customTools: [markElement],
      goalLoop: clearTheList(),
      webMCP: { enabled: publish },
      inspector: external
        ? { placement: "external", demo }
        : mount === "session" && (demo ? { demo } : true),
      agentConnection: dogfood || connected,
      // The Structure lens and the search results render the page state; in
      // page state they would render themselves, over and over.
      ignore: dogfood ? rendersThePage : undefined,
    });
    window.fixtureAyme = runtime;
    // A Peek of the page's list, which the Tools lens lists under Peek
    // tools. Here, so a session that stops and starts again keeps it.
    const removePeek = runtime.peek(
      () => ({
        items: [...document.querySelectorAll("main ul > li")].map(
          (item) => item.textContent
        ),
      }),
      "list"
    );
    runtime.pom.register(PageObject);
    for (const Other of alsoRegister) runtime.pom.register(Other);
    const stop = runtime.start();
    if (mount === "after" && !external)
      inspector = mountInspector({ demo, dogfood });
    root.fixture = "ready";
    return () => {
      for (const Other of alsoRegister) runtime.pom.unregister(Other);
      runtime.pom.unregister(PageObject);
      removePeek();
      stop();
      inspector?.dispose();
    };
  } catch (error) {
    root.fixture = "failed";
    root.fixtureError = error instanceof Error ? error.message : String(error);
    throw error;
  }
}
