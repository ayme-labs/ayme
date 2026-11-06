// The browser runtime: the session code of `session.ts` over its document,
// through its own Playwright Lite page. A Node host composes the same session
// code over a Playwright Page it was handed (`playwrightRuntime.ts`).
import {
  browserRegistry,
  createAymeRuntime,
  createPage,
  probeRegisteredPomMembers,
} from "../page-objects/infrastructure";
import {
  checkCustomToolFilters,
  peeksOf,
  processPeeks,
} from "../tools/infrastructure";
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
import { loadWebMcpPublication } from "./webMcp";
import { browserToolSources } from "./publishedTools";
import {
  appProcessToolsBySession,
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
    prepare: (options) => ({
      // Checked before anything starts: a filter the page cannot run throws here.
      ignore:
        options.ignore === undefined
          ? undefined
          : registerFilter("`ignore`", options.ignore),
      customFilters: checkCustomToolFilters(options.customTools),
      customTools: options.customTools?.map(registerCustomTool),
    }),
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
