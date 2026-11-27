// A Session as the Host of its Tabs: on each Tab it works on, the project's
// own Node Host of @ayme-dev/ayme over the Tab's Playwright page, running
// the built Page Objects there. ayme reaches a page only through that page,
// from Node.
import { pathToFileURL } from "node:url";
import { Effect, SubscriptionRef } from "effect";
import type { Browser, CDPSession, Page } from "playwright-core";

import type {
  BrowserTab,
  BrowserTabs,
  HostedTab,
} from "../../../session/application";
import {
  SessionStartError,
  showsWindow,
  TabReadError,
  type RunAnswer,
  type TabDialog,
} from "../../../session/domain";
import type { NodePageObjects } from "../../../page-objects/infrastructure";
import { listedTools, type NodeHostTool } from "../listedTools";
import { runErrorOf } from "../runError";
import { failingOnItsUncaught } from "../runUncaught";
import { dialogOpenMs, tabDialogs, type ActionCalls } from "../tabDialogs";
import { handedOver, readTabOrder, tabListAddress } from "../tabList";
import { tabInspector, type InspectorPort } from "./tabInspector";

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
      actionCalls: ActionCalls;
    },
    selectors: unknown
  ): { start(): Promise<() => void> };
  createPageObjectIdSource(): IdSource;
  replacePageObjects(
    ayme: unknown,
    running: readonly unknown[],
    rebuilt: readonly unknown[]
  ): void;
  inspectorPortOf(ayme: unknown): InspectorPort;
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
/** Each page's dialogs as the Session counts them, watched over ayme's own
 * DevTools session from the first time the Session reads the page's tab:
 * Playwright tells no dialog closing. */
const watched = new WeakMap<
  Page,
  {
    readonly dialogs: ReturnType<typeof tabDialogs>;
    readonly dialog: SubscriptionRef.SubscriptionRef<TabDialog>;
    /** Settles once the browser tells the session of the page's dialogs. */
    readonly started: Promise<unknown>;
  }
>();
const dialogsOf = (page: Page) => {
  let watch = watched.get(page);
  if (!watch) {
    const dialog = Effect.runSync(SubscriptionRef.make<TabDialog>("none"));
    const dialogs = tabDialogs(
      (now) => Effect.runSync(SubscriptionRef.set(dialog, now)),
      undefined,
      dialogOpenMs(process.env)
    );
    const started = devtools(page)
      .then((session) => {
        session.on("Page.javascriptDialogOpening", (opened) =>
          dialogs.opened({
            type: opened.type,
            message: opened.message,
            ...(opened.type === "prompt" && opened.defaultPrompt
              ? { defaultValue: opened.defaultPrompt }
              : {}),
          })
        );
        session.on("Page.javascriptDialogClosed", () => dialogs.closed());
        return session.send("Page.enable");
      })
      .catch(() => {});
    watch = { dialogs, dialog, started };
    watched.set(page, watch);
  }
  return watch;
};

/** The id of each page's tab, kept from its first lookup that succeeded,
 * since a page keeps its tab. */
const targetIds = new WeakMap<Page, Promise<string>>();
const targetIdOf = (page: Page) => {
  let id = targetIds.get(page);
  if (!id) {
    dialogsOf(page);
    id = devtools(page)
      .then((session) => session.send("Target.getTargetInfo"))
      .then(({ targetInfo }) => targetInfo.targetId);
    targetIds.set(page, id);
    id.catch(() => targetIds.delete(page));
  }
  return id;
};

/** The Tab's page as its Host reaches it through `caller`, running
 * `classes` on the Node Host `ayme` of `entry`. */
const hostedTab = (
  caller: ReturnType<NodeHostEntry["pageObjectCallerOf"]>,
  inspector: InspectorPort,
  dialog: SubscriptionRef.SubscriptionRef<TabDialog>,
  { entry, ayme }: { readonly entry: NodeHostEntry; readonly ayme: unknown },
  classes: readonly unknown[]
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
      try: () => failingOnItsUncaught(() => caller.run(tool, input)),
      catch: runErrorOf,
    }),
  inspector: tabInspector(inspector),
  dialog: SubscriptionRef.changes(dialog),
  swap: (pageObjects) =>
    Effect.try({
      try: () => {
        const rebuilt = (pageObjects as NodePageObjects).classes;
        entry.replacePageObjects(ayme, classes, rebuilt);
        classes = rebuilt;
      },
      catch: (cause) =>
        new TabReadError(
          `ayme could not swap the rebuilt Page Objects in on the tab: ${reason(cause)}`
        ),
    }),
});

/** What every Tab's Host shares: the project's entry, the one source of
 * Page Object Ids, and Playwright's selectors. */
type Hosting = {
  readonly entry: NodeHostEntry;
  readonly ids: IdSource;
  readonly selectors: unknown;
};

/** Makes the Session the Host of `page`, running the built Page Objects it
 * is handed, with focus emulation on, telling `tabIds` of each Page Object
 * Id its Host gives out and forgets. The Node Host's start sets
 * up the page's binding and its in-page helper without waiting for either,
 * so it reads nothing of the page. The Host stops when the page closes. */
const hostOn =
  ({ entry, ids, selectors }: Hosting, page: Page): BrowserTab["host"] =>
  (tabIds, pageObjects) =>
    Effect.tryPromise({
      try: async () => {
        const { classes } = pageObjects as NodePageObjects;
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
        const { dialogs, dialog, started } = dialogsOf(page);
        // So that the first dialog a Run's action opens is heard.
        await started;
        const ayme = entry.createNodeHost(
          {
            page,
            pageObjects: classes,
            pageObjectIds: { next, released: tabIds.released },
            actionCalls: dialogs.actionCalls,
          },
          selectors
        );
        const stop = await ayme.start();
        if (page.isClosed()) stop();
        else page.once("close", stop);
        return hostedTab(
          entry.pageObjectCallerOf(ayme, CALLER),
          entry.inspectorPortOf(ayme),
          dialog,
          { entry, ayme },
          classes
        );
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

/** The Tabs of `browser`, which lists its tabs at `list`, each the
 * same object while its page is open; a tab that shows the Inspector window
 * served at `window` is none of them, and no read waits for it. */
function tabsOf(
  browser: Browser,
  list: string,
  hosting: Hosting,
  window: string | undefined
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
        const order = await readTabOrder(list, {
          signal,
          deadline: TAB_LIST_DEADLINE_MS,
          without: (url) => window !== undefined && showsWindow(url, window),
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
 * protocol is at `address`, on the Node Host of the `@ayme-dev/ayme` the
 * built `pageObjects` run on and the Playwright whose `selectors` drive the
 * pages. Every
 * Tab's Host takes its Page Object Ids from one source. Reads no page.
 * Refuses an address that tells nothing of where the browser lists its
 * tabs, since every command needs that list. A tab that shows the Inspector
 * window served at `window` is none of its Tabs.
 */
export const hostTabs = (
  browser: Browser,
  address: string,
  selectors: unknown,
  { nodeHost }: NodePageObjects,
  window: string | undefined
): Effect.Effect<BrowserTabs, SessionStartError> =>
  Effect.tryPromise({
    try: async () =>
      (await import(pathToFileURL(nodeHost).href)) as NodeHostEntry,
    catch: (cause) =>
      new SessionStartError(
        `ayme could not run the project's Page Objects: ${reason(cause)}`
      ),
  }).pipe(
    Effect.flatMap((entry) =>
      Effect.try({
        try: () =>
          tabsOf(
            browser,
            tabListAddress(address),
            {
              entry,
              ids: entry.createPageObjectIdSource(),
              selectors,
            },
            window
          ),
        catch: (cause) => new SessionStartError(reason(cause)),
      })
    )
  );
