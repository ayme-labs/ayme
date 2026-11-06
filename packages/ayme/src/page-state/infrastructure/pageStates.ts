// Runtime, not publication. Every store of page-state is keyed by Page
// (ADR-0049): the Page State Session, the Change Record cursors and what a
// capture reads besides the page. The browser runtime keys them by its own
// Playwright Lite page, a Node host by the real Playwright Page it was
// handed, so two pages in one process share nothing. No store lives on
// `globalThis`; the document's one shared state is the in-page module's slot.
//
// This file holds nothing of the browser: how a page is reached (its host)
// is handed in, by `pageState.ts` for the browser and `playwrightHost.ts`
// for Node.

import {
  PageIdSchema,
  type AriaRef,
} from "@ayme-dev/core/structural-observation";
import type { Locator, Page } from "@playwright/test";
import type { inPage } from "../../in-page";
import type { ElementInputs } from "../../in-page";
import {
  browserMonotonicClock,
  PREDICATES,
  type Capture,
  type FilterData,
  type NamedFilter,
  type Predicate,
} from "../../shared";
import { structureCapture, treeRefAllocator } from "../domain/capturedPage";
import { createCursors, type Cursors } from "../domain/cursors";
import { InteractionHistory } from "../domain/interactionHistory";
import {
  renderPageState,
  type PageStateLook,
} from "../domain/structuralPageState";
import {
  PageStateSession,
  type PageAction,
} from "../application/pageStateSession";

/**
 * How a page is reached for its Page State Session: the browser runtime's
 * host reaches its document through its Playwright Lite page, a Node host
 * the Playwright Page it was handed. Either way the session code is the same.
 */
export type PageStateHost = {
  /** Where the page is now: the first Visit of its history. */
  url(): string;
  /**
   * Binds the page's in-page module and calls `onVisit` once it is bound and
   * after each same-document navigation in it.
   */
  bind(
    onVisit: (visit: { url: string; cause: "initial" | "navigate" }) => void
  ): void;
  /** A capture of the page with these exclusions and asks. */
  capture(
    inputs: ElementInputs,
    ask: { accepts?: readonly Predicate[]; filters?: readonly NamedFilter[] }
  ): Promise<Capture>;
  /**
   * Begins an action: the before capture, and the action, whose captures read
   * `inputs` again each, as the registry probes its roots right before each
   * capture.
   */
  begin(inputs: () => Promise<ElementInputs>): Promise<PageAction>;
};

/** What a capture reads besides the page, set by the session that owns it. */
type CaptureSources = {
  /** What a capture waits for before it reads the page: a completed probe run. */
  probe?: () => Promise<void>;
  /** The filters of the elements the app leaves out, and everything under them. */
  ignores?: readonly FilterData[];
  /** The Custom Tools' filters, whose accepted refs every capture carries. */
  filters?: readonly NamedFilter[];
};

const sources = new WeakMap<Page, CaptureSources>();
const cursorsByPage = new WeakMap<Page, Cursors>();

function sourcesOf(page: Page): CaptureSources {
  let found = sources.get(page);
  if (!found) sources.set(page, (found = {}));
  return found;
}

/** The page's Change Record cursors: module state is the page's, as is its Run log. */
export function cursorsOf(page: Page): Cursors {
  let found = cursorsByPage.get(page);
  if (!found) cursorsByPage.set(page, (found = createCursors()));
  return found;
}

/**
 * Package-internal: what captures of `page` wait for before they read it, set
 * while the registry observes it: the roots the module places are those of a
 * completed probe run. Unset, a capture waits for none, as when no Page
 * Object is registered.
 */
export function providePageObjectProbeOf(
  page: Page,
  probe: (() => Promise<void>) | undefined
): void {
  sourcesOf(page).probe = probe;
}

/**
 * Package-internal: resolves once the roots the module places for `page` are
 * those of a completed probe run; undefined while no Page Object is
 * registered.
 */
export function pageObjectsProbed(page: Page): Promise<void> | undefined {
  return sourcesOf(page).probe?.();
}

/** Package-internal: set while a runtime session is active, as checked filter data. */
export function configurePageStateIgnoreOf(
  page: Page,
  ignore: FilterData | undefined
): void {
  sourcesOf(page).ignores = ignore ? [ignore] : undefined;
}

/**
 * Package-internal: the Custom Tools' filters, as checked, under each tool's
 * name; every capture carries the refs each keeps.
 */
export function configurePageStateFiltersOf(
  page: Page,
  filters: readonly NamedFilter[] | undefined
): void {
  sourcesOf(page).filters = filters;
}

/** One page's Page State Session and the captures it makes. */
export type PageStateStore = {
  readonly session: PageStateSession;
  /** A capture nobody records, as text. */
  capturePageState(): Promise<string>;
  /** A capture nobody records, asking for every predicate. */
  look(): Promise<PageStateLook>;
};

const stores = new WeakMap<Page, PageStateStore>();
let documentCount = 0;

/** The page's store, if its Page State Session was created. */
export function existingPageState(page: Page): PageStateStore | undefined {
  return stores.get(page);
}

/**
 * The page's store, created on first use over `host`. Creating its session
 * installs the page's in-page module, or binds to the one there, and starts
 * its history with the page's first Visit.
 */
export function pageStateOf(page: Page, host: PageStateHost): PageStateStore {
  let found = stores.get(page);
  if (!found) stores.set(page, (found = createStore(page, host)));
  return found;
}

function createStore(page: Page, host: PageStateHost): PageStateStore {
  const read = sourcesOf(page);
  // What a capture leaves out besides the excluded subtrees, which the
  // module always does: the `ignore` of this runtime. The Page Object Roots it
  // places are those the module holds from the registry's probe runs,
  // current once the probe it waits for has resolved.
  async function elementInputs(): Promise<ElementInputs> {
    await read.probe?.();
    return { ignores: [...(read.ignores ?? [])] };
  }
  const captureWith = async (accepts?: readonly Predicate[]) => {
    const inputs = await elementInputs();
    return host.capture(inputs, { accepts, filters: read.filters ?? [] });
  };

  const history = new InteractionHistory({
    pageId: PageIdSchema.parse(`document_${++documentCount}`),
    url: host.url(),
    clock: browserMonotonicClock,
  });
  let url = host.url();
  host.bind((visit) => {
    if (visit.cause === "initial" && visit.url === url) return;
    url = visit.url;
    history.recordNavigation(visit.url);
  });
  const session = new PageStateSession(history, captureWith, {
    begin: () => host.begin(elementInputs),
  });
  return {
    session,
    // The Inspector offers each tool the refs it takes, so a look carries them.
    look: () => session.look({ accepts: PREDICATES }),
    async capturePageState() {
      return renderPageState(
        structureCapture(await captureWith(), treeRefAllocator())
      ).text;
    },
  };
}

/**
 * The Structural Ref the latest recorded page state of the page keyed
 * `page` gave the one element `locator` matches, read in the page through
 * `module`; undefined for none or several, or until a page state gave it
 * one.
 */
export async function latestRefOfLocator(
  page: Page,
  module: ReturnType<typeof inPage>,
  locator: Locator
): Promise<AriaRef | undefined> {
  const refs = await module.elements.refs(locator);
  const ref = refs.length === 1 ? (refs[0] as AriaRef | undefined) : undefined;
  return ref !== undefined &&
    existingPageState(page)?.session.latestRefOfNamed(ref)
    ? ref
    : undefined;
}
