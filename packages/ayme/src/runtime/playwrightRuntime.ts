// The runtime session of a Node host over a real Playwright Page (ADR-0049):
// the same session code and adapters as the browser's, composed over the
// Page it was handed. Its stores are the Page's, so two pages in one process
// share nothing. It holds nothing of the browser: Playwright Lite, the
// document's globals and the Inspector's loaders stay with the browser
// runtime.
import type { Locator, Page } from "@playwright/test";
import { inPage } from "../in-page";
import { listCustomToolsOf } from "../tools/infrastructure";
import {
  registerCustomTool,
  type CustomTool,
  type RegisteredElementTool,
} from "../tools/application";
import {
  latestRefOfLocator,
  pageNavigation,
  pageStateOf,
  playwrightPageHost,
  providePageObjectProbeOf,
} from "../page-state/infrastructure";
import { pomRegistryOf } from "../page-objects/infrastructure";
import type { PageObjectConstructor } from "../page-objects/application";
import type { ElementFilter } from "../shared";
import {
  createAymeOn,
  type Ayme,
  type PreparedOptions,
  type SessionTarget,
} from "./session";
import type { ToolSources } from "./publishedTools";
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
   * The elements an agent does not see: a CSS selector, or a self-contained
   * function the page runs over each element.
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
 * checks the options' filters in the page first, so it resolves with the
 * function that stops the session.
 */
export type PlaywrightAyme = Omit<Ayme, "start"> & {
  start(): Promise<() => void>;
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
  return {
    ...core,
    async start() {
      await registerSelectors();
      prepared = await prepare(page, options);
      return core.start();
    },
  };
}

/** The filters checked as the page runs them, and the Custom Tools registered. */
async function prepare(
  page: Page,
  options: PlaywrightAymeOptions
): Promise<PreparedOptions> {
  const { ignore, customFilters } = await checkedFilters(
    (data) => inPage(page).checkFilter(data),
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
    prepare: () => prepared(),
    latestRefOf: (locator: Locator) =>
      latestRefOfLocator(page, inPage(page), locator),
  };
}
