// A Session as the Host of its Tabs: on each Tab it works on, the project's
// own Node Host of @ayme-dev/ayme over the Tab's Playwright page, running
// the built Page Objects there. ayme reaches a page only through that page,
// from Node.
import { pathToFileURL } from "node:url";
import { Effect, Stream, SubscriptionRef } from "effect";
import type {
  Browser,
  BrowserContext,
  CDPSession,
  Dialog as PlaywrightDialog,
  Page,
} from "playwright-core";

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
import { failingOnItsUncaught, LeftUncaught } from "../runUncaught";
import { tabDialogs, type ActionCalls } from "../tabDialogs";
import { handedOver, readTabOrder, tabListAddress } from "../tabList";
import { lazyPort, type InspectorPort } from "../inspectorPort";
import { tabInspector } from "./tabInspector";

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
  pageObjectToolTakesId(ayme: unknown, tool: string): boolean;
  observePageObjects(ayme: unknown): Promise<void>;
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

// ayme's own setup on a page over DevTools answers in milliseconds; a page
// that has not answered by then, as one Chromium holds behind a dialog,
// holds no command for longer, nor the commands of other Tabs. A Run has no
// such limit.
const SETUP_DEADLINE_MS = 5000;

/** `work`, failed once the page has not answered `what` within the
 * limit. */
const withinSetup = <T>(work: Promise<T>, what: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            `the tab did not answer ${what} within ${SETUP_DEADLINE_MS / 1000} seconds`
          )
        ),
      SETUP_DEADLINE_MS
    );
    void work.then(resolve, reject).finally(() => clearTimeout(timer));
  });

/** One DevTools session of ayme's own per page: it names the page's tab in
 * the browser's tab list, and holds the page's focus emulation, which
 * Chromium keeps only while the session that set it stays. One that failed
 * is made again by the next use. */
const devtoolsOf = new WeakMap<Page, Promise<CDPSession>>();
const devtools = (page: Page) => {
  let session = devtoolsOf.get(page);
  if (!session) {
    const making = page.context().newCDPSession(page);
    const made = withinSetup(making, "ayme's DevTools session");
    devtoolsOf.set(page, made);
    const forget = () => {
      if (devtoolsOf.get(page) === made) devtoolsOf.delete(page);
    };
    void made.then(
      (ended) => ended.once("close", forget),
      () => {}
    );
    made.catch(() => {
      forget();
      void making.then(
        (late) => late.detach(),
        () => {}
      );
    });
    session = made;
  }
  return session;
};

/** Each page's dialogs as the Session counts them, watched from when
 * Playwright hands the page over: ayme's own DevTools session tells each
 * dialog opening and closing, which Playwright does not. */
type Watch = {
  readonly dialogs: ReturnType<typeof tabDialogs>;
  readonly dialog: SubscriptionRef.SubscriptionRef<TabDialog>;
  /** Settles once the browser tells the session of the page's dialogs. */
  readonly started: Promise<void>;
};
const watched = new WeakMap<Page, Watch>();
/** A dialog as Chromium tells of it opening. */
type Opening = {
  readonly type: string;
  readonly message: string;
  readonly defaultPrompt?: string;
};
const dialogOf = ({ type, message, defaultPrompt }: Opening) => ({
  type,
  message,
  ...(type === "prompt" && defaultPrompt
    ? { defaultValue: defaultPrompt }
    : {}),
});
const dialogsOf = (page: Page): Watch => {
  const known = watched.get(page);
  if (known) return known;
  const dialog = Effect.runSync(SubscriptionRef.make<TabDialog>("none"));
  const dialogs = tabDialogs((now) =>
    Effect.runSync(SubscriptionRef.set(dialog, now))
  );
  let enabled = false;
  let heard = false;
  let replayed = false;
  let session: CDPSession | undefined;
  // Chromium answers Page.enable for no session that attached while a
  // dialog is open, as on a popup that opens one as it loads; Playwright's
  // own session attached before the page ran, so it tells of that dialog.
  const told = (shown: PlaywrightDialog) => {
    if (enabled) return;
    heard = true;
    dialogs.opened(
      dialogOf({
        type: shown.type(),
        message: shown.message(),
        defaultPrompt: shown.defaultValue(),
      })
    );
  };
  // A dialog the browser tells of before it answered Page.enable was open
  // before the watch began.
  const opening = (opened: Opening) => {
    if (enabled) return dialogs.opened(dialogOf(opened));
    replayed = true;
    dialogs.alreadyOpen(dialogOf(opened));
  };
  const closing = () => dialogs.closed();
  // The watch ends with the page, with ayme's DevTools session, and with
  // the Session, whose end closes its connection and so every page of it;
  // one that failed to start is forgotten too, so the next command watches
  // the page again.
  const end = () => {
    dialogs.end();
    page.off("dialog", told);
    page.off("close", end);
    session?.off("Page.javascriptDialogOpening", opening);
    session?.off("Page.javascriptDialogClosed", closing);
    session?.off("close", end);
    if (watched.get(page) === watch) watched.delete(page);
  };
  page.on("dialog", told);
  page.once("close", end);
  const started = devtools(page)
    .then((made) => {
      session = made;
      made.once("close", end);
      made.on("Page.javascriptDialogOpening", opening);
      made.on("Page.javascriptDialogClosed", closing);
      return made.send("Page.enable");
    })
    .then(() => {
      enabled = true;
      // The dialog Playwright told of held Page.enable until it closed.
      if (heard && !replayed) dialogs.closed();
    });
  const watch: Watch = { dialogs, dialog, started };
  watched.set(page, watch);
  started.catch(end);
  return watch;
};

/** Watches the dialogs of each page of `browser` from when Playwright hands
 * it over, those of contexts made later among them. */
export function watchDialogs(browser: Browser): void {
  const watchContext = (context: BrowserContext) => {
    context.pages().forEach(dialogsOf);
    context.on("page", dialogsOf);
  };
  browser.contexts().forEach(watchContext);
  browser.on("context", watchContext);
}

/** The id of each page's tab, kept from its first lookup that succeeded,
 * since a page keeps its tab. */
const targetIds = new WeakMap<Page, Promise<string>>();
const targetIdOf = (page: Page) => {
  let id = targetIds.get(page);
  if (!id) {
    dialogsOf(page);
    id = devtools(page)
      .then((session) =>
        withinSetup(
          session.send("Target.getTargetInfo"),
          "ayme's lookup of its tab"
        )
      )
      .then(({ targetInfo }) => targetInfo.targetId);
    targetIds.set(page, id);
    id.catch(() => targetIds.delete(page));
  }
  return id;
};

/** The Tab's page as its Host reaches it through `caller`, running
 * `classes` on the Node Host `ayme` of `entry`, each Run a request of
 * `dialogs`, which a dialog stops. */
const hostedTab = (
  caller: ReturnType<NodeHostEntry["pageObjectCallerOf"]>,
  inspector: InspectorPort,
  { dialogs, dialog }: Pick<Watch, "dialogs" | "dialog">,
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
      try: () =>
        dialogs.request(() =>
          failingOnItsUncaught(() => caller.run(tool, input))
        ),
      catch: runErrorOf,
    }),
  // A Run from the window fails on what its code left uncaught, as a
  // command's does.
  inspector: tabInspector({
    ...inspector,
    request: (method, params) =>
      method === "runTool"
        ? dialogs.request(() =>
            failingOnItsUncaught(() => inspector.request(method, params)).catch(
              (cause: unknown) => {
                if (!(cause instanceof LeftUncaught)) throw cause;
                throw new TabReadError(reason(cause.error), cause.ended);
              }
            )
          )
        : inspector.request(method, params),
  }),
  dialog: SubscriptionRef.changes(dialog),
  takesId: (tool) => entry.pageObjectToolTakesId(ayme, tool),
  observe: Effect.tryPromise({
    try: () => entry.observePageObjects(ayme),
    catch: (cause) =>
      new TabReadError(`ayme could not read the page: ${reason(cause)}`),
  }),
  swap: (pageObjects) =>
    Effect.try({
      try: () => {
        const rebuilt = (pageObjects as NodePageObjects).classes;
        entry.replacePageObjects(ayme, classes, rebuilt);
        classes = rebuilt;
      },
      catch: (cause) => new TabReadError(reason(cause)),
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
      try: async (signal) => {
        const { classes } = pageObjects as NodePageObjects;
        const watch = dialogsOf(page);
        // So that the Tab's dialog is known before it is hosted, and the
        // first dialog a Run's action opens is heard.
        await withinSetup(watch.started, "ayme's watch of its dialogs");
        signal.throwIfAborted();
        // So that a Run works the same while the Tab is not in front
        // (ADR-0071).
        await withinSetup(
          (await devtools(page)).send("Emulation.setFocusEmulationEnabled", {
            enabled: true,
          }),
          "ayme's focus emulation"
        );
        // The Session stopped hosting the Tab, as its dialog counts: no Node
        // Host takes the page.
        signal.throwIfAborted();
        const next = (className: string) => {
          const id = ids.next(className);
          tabIds.given(id, className);
          return id;
        };
        const { dialogs } = watch;
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
          lazyPort(() => entry.inspectorPortOf(ayme)),
          watch,
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
      // Each wait for the close lets go of its listener once it is over.
      closed: Effect.callback<void>((resume) => {
        const closed = () => resume(Effect.void);
        page.once("close", closed);
        if (page.isClosed()) closed();
        return Effect.sync(() => page.off("close", closed));
      }),
      dialog: Stream.unwrap(
        Effect.sync(() => SubscriptionRef.changes(dialogsOf(page).dialog))
      ),
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
