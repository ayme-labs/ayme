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
  toolFilterKey,
  type Capture,
  type DocumentToken,
  type FilterData,
  type NamedFilter,
  type Predicate,
  type SessionFilter,
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
    onVisit: (visit: {
      document: DocumentToken;
      url: string;
      cause: "initial" | "navigate";
    }) => void
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
  /**
   * Hands the page's in-page module the elements `locator` matches now, under
   * `key`, which a filter's data names in this host's captures from then on.
   */
  match(locator: Locator, key: string): Promise<void>;
  /** Has the page's in-page module drop the matches this host handed under `keys`. */
  forget(keys: readonly string[]): Promise<void>;
};

/** What a capture reads besides the page, set by the session that owns it. */
type CaptureSources = {
  /** What a capture waits for before it reads the page: a completed probe run. */
  probe?: () => Promise<void>;
  /** The filter of the elements the app leaves out, and everything under them. */
  ignore?: SessionFilter;
  /** The Custom Tools' filters, whose accepted refs every capture carries. */
  filters?: readonly NamedFilter<SessionFilter>[];
};

/** The key the `ignore` Locator's matches go to the module under; a Custom Tool's is `toolFilterKey`. */
const IGNORE_KEY = "ignore";

const sources = new WeakMap<Page, CaptureSources>();
const cursorsByPage = new WeakMap<Page, Cursors>();

function sourcesOf(page: Page): CaptureSources {
  let found = sources.get(page);
  if (!found) sources.set(page, (found = {}));
  return found;
}

/** The keys under which captures of `read` hand the module a Locator's matches. */
function locatorKeys({ ignore, filters = [] }: CaptureSources): string[] {
  const keys = filters
    .filter(({ filter }) => "locator" in filter)
    .map(({ name }) => toolFilterKey(name));
  return ignore && "locator" in ignore ? [IGNORE_KEY, ...keys] : keys;
}

/**
 * Sets what captures of `page` read, and has its module drop the matches of
 * the keys they name no more, as all of them once the session stops.
 */
function reconfigure(page: Page, change: Partial<CaptureSources>): void {
  const read = sourcesOf(page);
  const before = locatorKeys(read);
  Object.assign(read, change);
  const named = new Set(locatorKeys(read));
  const retired = before.filter((key) => !named.has(key));
  // Best effort: the page may be gone.
  if (retired.length)
    void hosts
      .get(page)
      ?.forget(retired)
      .catch(() => {});
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

/**
 * Package-internal: whether the session on `page` ignores what a Locator
 * matches, whose matches a capture takes again before it reads the page.
 */
export function ignoresByLocator(page: Page): boolean {
  const { ignore } = sourcesOf(page);
  return ignore !== undefined && "locator" in ignore;
}

/** Package-internal: set while a runtime session is active, as the session registered it. */
export function configurePageStateIgnoreOf(
  page: Page,
  ignore: SessionFilter | undefined
): void {
  reconfigure(page, { ignore });
}

/**
 * Package-internal: the Custom Tools' filters, as the session registered
 * them, under each tool's name; every capture carries the refs each keeps.
 */
export function configurePageStateFiltersOf(
  page: Page,
  filters: readonly NamedFilter<SessionFilter>[] | undefined
): void {
  reconfigure(page, { filters });
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
// The host each store reaches its page through, which handed its matches.
const hosts = new WeakMap<Page, PageStateHost>();
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
  if (!found) {
    stores.set(page, (found = createStore(page, host)));
    hosts.set(page, host);
  }
  return found;
}

function createStore(page: Page, host: PageStateHost): PageStateStore {
  const read = sourcesOf(page);

  /**
   * `filter` as the module reads it in the capture that follows: a selector
   * as it is, a Locator as the key of the elements it matches now, which go
   * to the module under `key` first. The matches are taken here, a round
   * trip before the capture reads them: an element that appears between the
   * two is left out, or offered, only from the next capture on.
   */
  async function filterInput(
    filter: SessionFilter,
    key: string
  ): Promise<FilterData> {
    if ("selector" in filter) return filter;
    await host.match(filter.locator, key);
    return { matches: key };
  }

  // What a capture leaves out besides the excluded subtrees, which the
  // module always does: the `ignore` of this runtime. The Page Object Roots it
  // places are those the module holds from the registry's probe runs,
  // current once the probe it waits for has resolved.
  async function elementInputs(): Promise<ElementInputs> {
    await read.probe?.();
    return {
      ignores: read.ignore ? [await filterInput(read.ignore, IGNORE_KEY)] : [],
    };
  }
  const captureWith = async (accepts?: readonly Predicate[]) => {
    const inputs = await elementInputs();
    const filters = await Promise.all(
      (read.filters ?? []).map(async ({ name, filter }) => ({
        name,
        filter: await filterInput(filter, toolFilterKey(name)),
      }))
    );
    return host.capture(inputs, { accepts, filters });
  };

  let url = host.url();
  // Each document has a history, identity ledger and cursors of its own, as
  // the browser runtime's, which a full load replaces; the session starts a
  // new one when a capture is of another document (cursors do too, for a
  // history takes no position of another document's).
  const newHistory = (at: string) =>
    new InteractionHistory({
      pageId: PageIdSchema.parse(`document_${++documentCount}`),
      url: at,
      clock: browserMonotonicClock,
    });
  const session = new PageStateSession(
    newHistory(url),
    captureWith,
    { begin: () => host.begin(elementInputs) },
    newHistory
  );
  let bound: DocumentToken | undefined;
  host.bind((visit) => {
    const known = bound;
    bound = visit.document;
    // Another document than the one this session read: a full load, which
    // the session's next capture starts over in.
    if (known !== undefined && known !== visit.document) {
      url = visit.url;
      return;
    }
    if (visit.cause === "initial" && visit.url === url) return;
    url = visit.url;
    session.history.recordNavigation(visit.url);
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
