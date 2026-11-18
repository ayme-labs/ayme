// The runtime session of a Node host over a real Playwright Page (ADR-0049):
// the same session code and adapters as the browser's, composed over the
// Page it was handed. Its stores are the Page's, so two pages in one process
// share nothing. It holds nothing of the browser: Playwright Lite, the
// document's globals and the Inspector's loaders stay with the browser
// runtime.
import { SETTLED_PAGE_DEADLINE_MS } from "@ayme-dev/core/structural-observation";
import type { Locator, Page } from "@playwright/test";
import { inPage } from "../in-page";
import { listCustomToolsOf } from "../tools/infrastructure";
import {
  pageObjectsTool,
  registerCustomTool,
  type CustomTool,
  type RegisteredElementTool,
} from "../tools/application";
import {
  latestRefOfLocator,
  pageNavigation,
  pageStateOf,
  playwrightPageHost,
  providePageObjectIdsOf,
  providePageObjectProbeOf,
} from "../page-state/infrastructure";
import { pomRegistryOf } from "../page-objects/infrastructure";
import type { PageObjectConstructor } from "../page-objects/application";
import type { ElementFilter } from "../shared";
import {
  agentToolsBySession,
  createAymeOn,
  type AgentTools,
  type Ayme,
  type PreparedOptions,
  type SessionTarget,
} from "./session";
import type { ToolSources } from "./publishedTools";
import type { LoadWatch } from "./pageObjectToolSource";
import { checkedFilters } from "./checkedFilters";

export type { Ayme } from "./session";

/**
 * What a Node host creates a session with: the Playwright Page it drives, and
 * the options of the browser runtime that make sense without a document.
 */
export type PlaywrightAymeOptions = {
  /** The Playwright Page the session drives; its state is kept under this Page. */
  page: Page;
  /**
   * The elements an agent does not see, and everything under them: a CSS
   * selector, or a function called once with `page` when the session starts,
   * returning the Locator of them, which each capture resolves again.
   */
  ignore?: ElementFilter;
  /** Custom Tools, acting on the element they are given through a Locator. */
  customTools?: CustomTool[];
  /** Page Objects registered for the session's lifetime. */
  pageObjects?: readonly PageObjectConstructor[];
  /** The application's router navigation, called with a same-origin URL. */
  navigate?: (url: string) => unknown;
};

/**
 * A Node host's session: the runtime object of the browser, but its `start()`
 * checks the options' selectors in the page first, so it resolves with the
 * function that stops the session.
 */
export type PlaywrightAyme = Omit<Ayme, "start"> & {
  start(): Promise<() => void>;
  /**
   * Spike: the session's tools as an agent reads and calls them, the way
   * `ayme mcp` and WebMCP publication do in the browser: a Page Object Tool
   * answers what it changed in the Page Object Tree, not the full record.
   * Its Runs are `ayme-mcp`'s.
   */
  readonly agentTools: AgentTools;
};

/**
 * A session over `options.page`; inert until started. `registerSelectors`
 * registers the `ayme-ref` engine on Playwright's `selectors`, once per
 * process, which the entry that holds the Playwright import hands in.
 */
export function createPlaywrightAyme(
  options: PlaywrightAymeOptions,
  registerSelectors: () => Promise<void>
): PlaywrightAyme {
  const { page } = options;
  let prepared: PreparedOptions | undefined;
  const target = playwrightTarget(page, () => prepared!);
  const core = createAymeOn(target, {
    pageObjects: options.pageObjects,
    navigate: options.navigate,
  });
  const agentTools = agentToolsBySession.get(core)!;
  return {
    ...core,
    agentTools: {
      list: agentTools.list,
      run: (name, input) =>
        name === pageObjectsTool.name
          ? readThroughLoads(page, () => agentTools.run(name, input))
          : agentTools.run(name, input),
    },
    async start() {
      await registerSelectors();
      prepared = await prepare(page, options);
      return core.start();
    },
  };
}

/**
 * The filters registered, selectors checked in the page and functions called
 * with `page`, and the Custom Tools registered.
 */
async function prepare(
  page: Page,
  options: PlaywrightAymeOptions
): Promise<PreparedOptions> {
  const { ignore, customFilters } = await checkedFilters(
    (filter) => inPage(page).checkFilter(filter),
    page,
    options
  );
  return {
    ignore,
    customFilters,
    customTools: options.customTools?.map(registerCustomTool),
  };
}

function playwrightTarget(
  page: Page,
  prepared: () => PreparedOptions
): SessionTarget {
  const host = playwrightPageHost(page);
  const pageState = () => pageStateOf(page, host);
  const registry = () =>
    pomRegistryOf(page, {
      latestPageStateRef: (ref) => pageState().session.latestRefOfNamed(ref),
      pageStates: {
        onPageStateRecorded: (listener) =>
          pageState().session.onRecorded(listener),
        providePageObjectProbe: (probe) =>
          providePageObjectProbeOf(page, probe),
        providePageObjectIds: (idsOf) => providePageObjectIdsOf(page, idsOf),
      },
    });
  const sources: ToolSources = {
    // The Goal Loop reads the document: a Node host offers none.
    goalTool: () => null,
    pomTools: () => registry().listRegisteredPomTools(),
    customTools: (): readonly RegisteredElementTool[] =>
      listCustomToolsOf(page),
    peekTools: () => [],
  };
  return {
    kind: "playwright",
    key: () => page,
    rawPage: () => page,
    pageState,
    registry,
    navigation: () => pageNavigation(page),
    peeks: () => undefined,
    toolSources: sources,
    claim: () => ({ dispose: registry().claim() }),
    watchLoads: () => watchLoads(page),
    prepare: () => prepared(),
    latestRefOf: (locator: Locator) =>
      latestRefOfLocator(page, inPage(page), locator),
  };
}

/** Whether `error` is Playwright's for a call whose context a load destroyed. */
const contextDestroyed = (error: unknown) =>
  error instanceof Error &&
  error.message.includes("Execution context was destroyed");

/**
 * Spike: `read` of the document `page` shows, once it has loaded: one that
 * is still loading is waited for, within Playwright's navigation timeout, and
 * a read whose document a load destroys reads the new one.
 */
async function readThroughLoads<T>(
  page: Page,
  read: () => Promise<T>
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    // As before when the wait runs out: the read reads what is there.
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    try {
      return await read();
    } catch (error) {
      if (attempt === 3 || !contextDestroyed(error)) throw error;
    }
  }
}

/**
 * Spike: the full loads of `page` from now on. A document a load brings
 * by the Settled Page deadline is waited for to settle, as after an action,
 * with the module's own deadline; a load it starts in turn is waited for
 * the same way.
 */
function watchLoads(page: Page): LoadWatch {
  let loads = 0;
  let wake = () => {};
  const onLoad = () => {
    loads += 1;
    wake();
  };
  page.on("domcontentloaded", onLoad);
  /** Whether a document loaded after the first `seen` by `deadline`. */
  const loadedAfter = (seen: number, deadline: number) =>
    new Promise<boolean>((resolve) => {
      if (loads > seen) return resolve(true);
      const timer = setTimeout(
        () => resolve(false),
        Math.max(0, deadline - Date.now())
      );
      wake = () => {
        clearTimeout(timer);
        resolve(true);
      };
    });
  return {
    async loaded() {
      const deadline = Date.now() + SETTLED_PAGE_DEADLINE_MS;
      for (let seen = 0; await loadedAfter(seen, deadline);) {
        seen = loads;
        const outcome = await inPage(page)
          .begin()
          .then((action) => action.perform(() => undefined))
          .catch(() => undefined);
        if (outcome && outcome.kind !== "loading")
          return { settled: outcome.stable };
      }
      return undefined;
    },
    stop: () => page.off("domcontentloaded", onLoad),
  };
}
