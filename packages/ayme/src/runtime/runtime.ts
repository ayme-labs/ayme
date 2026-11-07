// The browser runtime: the session code of `session.ts` over its document,
// through its own Playwright Lite page. A Node host composes the same session
// code over a Playwright Page it was handed (`playwrightRuntime.ts`).
import {
  browserRegistry,
  createAymeRuntime,
  createPage,
  probeRegisteredPomMembers,
} from "../page-objects/infrastructure";
import { peeksOf, processPeeks } from "../tools/infrastructure";
import { registerCustomTool } from "../tools/application";
import {
  browserPageState,
  documentNavigation,
  latestPageStateRefOf,
  pageOfDocument,
} from "../page-state/infrastructure";
import { registerFilter } from "../in-page";
import {
  demoFeedback,
  demoModeOptions,
  installRuntimePageInstrumentation,
  requestDemoMode,
} from "../runs/infrastructure";
import { runLogOf } from "../runs/application";
import { loadAgentConnection, loadProcessConnection } from "./agentConnection";
import { loadInspector } from "./inspector";
import { createDocumentInspectorContract } from "./documentInspectorContract";
import { loadWebMcpPublication } from "./webMcp";
import { browserToolSources } from "./publishedTools";
import { publishInspectorContract, type InspectorContract } from "../shared";
import {
  appProcessToolsBySession,
  getStartedAyme,
  subscribeToStartedAyme,
  createAppProcessTools,
  createAymeOn,
  serverKey,
  type Ayme,
  type AppProcessTools,
  type AymeOptions,
  type SessionTarget,
} from "./session";

export * from "./session";

/**
 * Create an inert runtime session. Its owner starts activity by calling
 * `start()`. `pageFactory` runs once, on first use in the browser; on the
 * server `pom.get` returns an inert Page Object. `ignore`, `customTools`,
 * `goalLoop` and `navigate` are configured on start and cleared on stop.
 */
export function createAyme(options: AymeOptions = {}): Ayme {
  return createAymeOn(browserTarget(options), options);
}

/**
 * The browser runtime's target: its document, through its own Playwright
 * Lite page.
 */
function browserTarget(options: AymeOptions): SessionTarget {
  // A server renders without a document, so without a Page: its session
  // keeps nothing a Page would key.
  const key = () =>
    typeof document === "undefined" ? serverKey : pageOfDocument(document);
  return {
    kind: "browser",
    key,
    rawPage: () => (options.pageFactory ?? createPage)(),
    pageState: () => browserPageState(),
    registry: () => ({
      ...browserRegistry(),
      probeRegisteredPomMembers: () => probeRegisteredPomMembers(),
    }),
    navigation: () => documentNavigation(document),
    peeks: () =>
      typeof window === "undefined" ? processPeeks : peeksOf(key()),
    toolSources: browserToolSources,
    claim: (page) => createAymeRuntime(page),
    // A filter is registered here, by this synchronous start: the browser's
    // realm is the page, so a selector is checked where the module matches
    // it, and a function is called with the session's Page.
    prepare: (options, page) => {
      const on = { page, root: document.documentElement };
      return {
        ignore:
          options.ignore === undefined
            ? undefined
            : registerFilter("`ignore`", options.ignore, on),
        customFilters: (options.customTools ?? []).flatMap(
          ({ name, filter }) =>
            filter === undefined
              ? []
              : [
                  {
                    name,
                    filter: registerFilter(
                      `\`filter\` of the Custom Tool \`${name}\``,
                      filter,
                      on
                    ),
                  },
                ]
        ),
        customTools: options.customTools?.map(registerCustomTool),
      };
    },
    latestRefOf: latestPageStateRefOf,
    feedback: (demo, signal) => {
      // Every session's Pages let pointer actions through the Inspector's
      // host while it covers them, whoever mounted the panel, and pace and
      // cue each call while anyone asks for Demo Mode: this session's
      // `inspector` option, or a panel mounted with `demo`.
      const stopFeedback = installRuntimePageInstrumentation((page) =>
        demoFeedback(page, demoModeOptions)
      );
      const releaseDemo = demo ? requestDemoMode() : () => {};
      signal.addEventListener(
        "abort",
        () => {
          stopFeedback();
          releaseDemo();
        },
        { once: true }
      );
    },
    surfaces: {
      loadWebMcpPublication,
      loadInspector,
      loadAgentConnection,
      loadProcessConnection,
      publishInspectorContract: () =>
        publishInspectorContract(runtimeInspectorContract()),
      loadExternalInspectorPort,
    },
  };
}

/** The App Process tools of the session `ayme`, for the Inspector. */
export function getAppProcessTools(ayme: Ayme): AppProcessTools {
  return (
    appProcessToolsBySession.get(ayme) ??
    createAppProcessTools(() => runLogOf(pageOfDocument(document))).tools
  );
}

let served: InspectorContract | undefined;

/**
 * The Inspector contract of the runtime's started session, served directly:
 * what the inline Inspector calls, with no serialization. One per document.
 */
export function runtimeInspectorContract(): InspectorContract {
  return (served ??= createDocumentInspectorContract({
    started: getStartedAyme,
    subscribeToStarted: subscribeToStartedAyme,
    appProcessTools: getAppProcessTools,
  }));
}

// The contract an Inspector outside the page reads, loaded on demand: only
// a session with the external placement carries it.
async function loadExternalInspectorPort() {
  const { externalInspectorPort } = await import("./externalInspector");
  return externalInspectorPort({
    started: getStartedAyme,
    subscribeToStarted: subscribeToStartedAyme,
    appProcessTools: getAppProcessTools,
  });
}
