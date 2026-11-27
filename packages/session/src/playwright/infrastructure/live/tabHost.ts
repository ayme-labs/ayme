// A Session as the Host of its Tabs: on each Tab it works on, the project's
// own Node Host of @ayme-dev/ayme over the Tab's Playwright page, running
// the built Page Objects there. ayme reaches a page only through that page,
// from Node.
import { pathToFileURL } from "node:url";
import { Effect } from "effect";
import type { Browser, CDPSession, Page } from "playwright-core";

import type {
  BrowserTab,
  BrowserTabs,
  HostedTab,
} from "../../../session/application";
import {
  SessionStartError,
  TabReadError,
  type RunAnswer,
} from "../../../session/domain";
import type { NodePageObjects } from "../../../page-objects/infrastructure";
import { listedTools, type NodeHostTool } from "../listedTools";
import { runErrorOf } from "../runError";
import { handedOver, readTabOrder, tabListAddress } from "../tabList";

/** Where a Node Host's Page Object Ids come from, and what hears that a
 * page forgot one. */
type IdSource = {
  next(className: string): string;
  released?(id: string): void;
};

/** What the Session uses of the project's `@ayme-dev/ayme/internal`. */
type NodeHostEntry = {
  createNodeHost(
    options: {
      page: Page;
      pageObjects: readonly unknown[];
      pageObjectIds: IdSource;
    },
    selectors: unknown
  ): { start(): Promise<() => void> };
  createPageObjectIdSource(): IdSource;
  pageObjectCallerOf(
    ayme: unknown,
    by: string
  ): {
    run(name: string, input: unknown): Promise<RunAnswer>;
    listing(): Promise<{
      pageObjectTree: string;
      tools: readonly NodeHostTool[];
      url: string;
      title: string;
    }>;
  };
};

// Playwright hands a new tab's page over within moments; a popup an action
// just opened is worth that wait before ayme chooses another Tab.
const HANDOVER_WAIT_MS = 2000;

// Chromium answers its tab list in milliseconds; one still unanswered by
// then is stuck, as behind a proxy that never ends the body. A Run has no
// such limit: this bounds only ayme's own lookup.
const TAB_LIST_DEADLINE_MS = 5000;

/** The Caller a Session's commands start their Runs as. */
const CALLER = "ayme-command";

const reason = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

/** One DevTools session of ayme's own per page: it names the page's tab in
 * the browser's tab list, and holds the page's focus emulation, which
 * Chromium keeps only while the session that set it stays. */
const devtoolsOf = new WeakMap<Page, Promise<CDPSession>>();
const devtools = (page: Page) => {
  let session = devtoolsOf.get(page);
  if (!session) {
    session = page.context().newCDPSession(page);
    devtoolsOf.set(page, session);
  }
  return session;
};
const targetIdOf = async (page: Page) =>
  (
    (await (await devtools(page)).send("Target.getTargetInfo")) as {
      targetInfo: { targetId: string };
    }
  ).targetInfo.targetId;

/** The Tab's page as its Host reaches it through `caller`. */
const hostedTab = (
  caller: ReturnType<NodeHostEntry["pageObjectCallerOf"]>
): HostedTab => ({
  // Each takes the Tab's turn, so it waits for the Run under way.
  listing: Effect.tryPromise({
    try: async () => {
      const { pageObjectTree, tools, url, title } = await caller.listing();
      return { pageObjectTree, tools: listedTools(tools), tab: { url, title } };
    },
    catch: (cause) =>
      new TabReadError(`ayme could not read the page: ${reason(cause)}`),
  }),
  call: (tool, input) =>
    Effect.tryPromise({
      try: () => caller.run(tool, input),
      catch: runErrorOf,
    }),
});

/** What every Tab's Host shares: the project's entry, the built classes,
 * the one source of Page Object Ids, and Playwright's selectors. */
type Hosting = {
  readonly entry: NodeHostEntry;
  readonly classes: readonly unknown[];
  readonly ids: IdSource;
  readonly selectors: unknown;
};

/** Makes the Session the Host of `page`, with focus emulation on, telling
 * `tabIds` of each Page Object Id its Host gives out and forgets. The Node Host's start sets
 * up the page's binding and its in-page helper without waiting for either,
 * so it reads nothing of the page. The Host stops when the page closes. */
const hostOn =
  (
    { entry, classes, ids, selectors }: Hosting,
    page: Page
  ): BrowserTab["host"] =>
  (tabIds) =>
    Effect.tryPromise({
      try: async () => {
        // So that a Run works the same while the Tab is not in front
        // (ADR-0071).
        await (
          await devtools(page)
        ).send("Emulation.setFocusEmulationEnabled", { enabled: true });
        const next = (className: string) => {
          const id = ids.next(className);
          tabIds.given(id, className);
          return id;
        };
        const ayme = entry.createNodeHost(
          {
            page,
            pageObjects: classes,
            pageObjectIds: { next, released: tabIds.released },
          },
          selectors
        );
        const stop = await ayme.start();
        if (page.isClosed()) stop();
        else page.once("close", stop);
        return hostedTab(entry.pageObjectCallerOf(ayme, CALLER));
      },
      catch: (cause) =>
        new TabReadError(
          `ayme could not run the project's Page Objects on the tab: ${reason(cause)}`
        ),
    });

/** Each page of `browser` by the id its tab has in the tab list; a page
 * that closed meanwhile has none. */
const pagesByTarget = async (browser: Browser) =>
  new Map(
    (
      await Promise.all(
        browser
          .contexts()
          .flatMap((context) => context.pages())
          .map((page) =>
            targetIdOf(page).then(
              (id) => [[id, page] as const],
              () => []
            )
          )
      )
    ).flat()
  );

/** The Tabs of `browser`, whose DevTools protocol is at `address`, each the
 * same object while its page is open. */
function tabsOf(
  browser: Browser,
  address: string,
  hosting: Hosting
): BrowserTabs {
  const tabs = new WeakMap<Page, BrowserTab>();
  const skipped = new Set<string>();
  const tabOf = (page: Page) => {
    const tab = tabs.get(page) ?? {
      url: () => page.url(),
      closed: Effect.callback<void>((resume) => {
        page.once("close", () => resume(Effect.void));
        if (page.isClosed()) resume(Effect.void);
      }),
      host: hostOn(hosting, page),
    };
    tabs.set(page, tab);
    return tab;
  };
  return {
    open: Effect.tryPromise({
      try: async (signal) => {
        const order = await readTabOrder(tabListAddress(address), {
          signal,
          deadline: TAB_LIST_DEADLINE_MS,
        });
        const until = Date.now() + HANDOVER_WAIT_MS;
        const pages = await handedOver(order, () => pagesByTarget(browser), {
          pause: () => new Promise((resolve) => setTimeout(resolve, 50)),
          over: () => signal.aborted || Date.now() > until,
          skipped,
        });
        return pages.map(tabOf);
      },
      catch: (cause) =>
        new TabReadError(
          `ayme could not read the browser's tab list: ${reason(cause)}`
        ),
    }),
  };
}

/**
 * Gets ready to be the Host of the Tabs of `browser`, whose DevTools
 * protocol is at `address`, running `pageObjects` on each Tab the Session
 * works on, on the Playwright whose `selectors` drive the pages. Every
 * Tab's Host takes its Page Object Ids from one source. Reads no page.
 */
export const hostTabs = (
  browser: Browser,
  address: string,
  selectors: unknown,
  { classes, nodeHost }: NodePageObjects
): Effect.Effect<BrowserTabs, SessionStartError> =>
  Effect.tryPromise({
    try: async () =>
      (await import(pathToFileURL(nodeHost).href)) as NodeHostEntry,
    catch: (cause) =>
      new SessionStartError(
        `ayme could not run the project's Page Objects: ${reason(cause)}`
      ),
  }).pipe(
    Effect.map((entry) =>
      tabsOf(browser, address, {
        entry,
        classes,
        ids: entry.createPageObjectIdSource(),
        selectors,
      })
    )
  );
